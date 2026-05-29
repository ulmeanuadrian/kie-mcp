import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { KieClient, FetchLike } from '../src/client.js';
import { buildServer } from '../src/server.js';
import { buildKieTools } from '../src/tools.js';
import { TaskStore } from '../src/store.js';
import { AssetDownloader } from '../src/downloader.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { MODEL_REGISTRY } from '../src/registry.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'kie-mcp-phase2-'));
afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore Windows lock contention on teardown
  }
});

const baseEnv: NodeJS.ProcessEnv = {
  KIE_API_KEY: 'sk-test-eval-key',
  KIE_API_BASE: 'https://api.test.kie.ai/api/v1',
  KIE_DB_PATH: join(tmpRoot, 'state.db'),
  KIE_OUTPUT_DIR: join(tmpRoot, 'assets'),
};

function mockFetch(steps: Array<{ status: number; body: unknown }>): {
  fetch: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      text: async () =>
        typeof step.body === 'string' ? step.body : JSON.stringify(step.body),
    } as Response;
  };
  return { fetch: fn, calls };
}

let dbCounter = 0;
function setupServer(steps: Array<{ status: number; body: unknown }>): {
  server: Server;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  dbCounter++;
  const env = { ...baseEnv, KIE_DB_PATH: join(tmpRoot, `state-${dbCounter}.db`) };
  const config = loadConfig(env);
  const { fetch, calls } = mockFetch(steps);
  const client = new KieClient(config, fetch);
  const store = new TaskStore(config.dbPath);
  const downloader = new AssetDownloader(config.outputDir);
  const tools = buildKieTools({ client, config, store, downloader });
  const server = buildServer(config, tools);
  return { server, calls };
}

function lookupHandler(
  server: Server,
  method: string,
): (req: { method: string; params: Record<string, unknown> }) => Promise<unknown> {
  const map = (server as unknown as {
    _requestHandlers: Map<
      string,
      (req: { method: string; params: Record<string, unknown> }) => Promise<unknown>
    >;
  })._requestHandlers;
  const fn = map.get(method);
  if (!fn) throw new Error(`no handler registered for ${method}`);
  return fn;
}

async function callTool(
  server: Server,
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const fn = lookupHandler(server, 'tools/call');
  return fn({ method: 'tools/call', params: { name, arguments: args } }) as Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

describe('Phase 2 — umbrella tools eval', () => {
  test('tools/list exposes all 6 umbrella tools + kie_health', async () => {
    const { server } = setupServer([]);
    const fn = lookupHandler(server, 'tools/list');
    const result = (await fn({ method: 'tools/list', params: {} })) as {
      tools: Array<{ name: string }>;
    };
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'kie_health',
        'kie_image',
        'kie_video',
        'kie_music',
        'kie_speech',
        'kie_status',
        'kie_models',
        'kie_upload',
      ]),
    );
  });

  test('kie_upload returns public http(s) url as-is (passthrough)', async () => {
    const { server, calls } = setupServer([]);
    const result = await callTool(server, 'kie_upload', {
      url: 'https://cdn.example.com/already-public.jpg',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe('https://cdn.example.com/already-public.jpg');
    expect(parsed.passthrough).toBe(true);
    expect(calls.length).toBe(0); // no network call for passthrough
  });

  test('kie_upload posts base64 to file-base64-upload and returns downloadUrl', async () => {
    const { server, calls } = setupServer([
      {
        status: 200,
        body: {
          success: true,
          code: 200,
          msg: 'File uploaded successfully',
          data: {
            downloadUrl: 'https://tempfile.redpandaai.co/kieai/1/images/user-upload/x.jpg',
            fileSize: 123,
            mimeType: 'image/jpeg',
          },
        },
      },
    ]);
    const result = await callTool(server, 'kie_upload', {
      base64: 'aGVsbG8=',
      file_name: 'x.jpg',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe('https://tempfile.redpandaai.co/kieai/1/images/user-upload/x.jpg');
    expect(parsed.mime_type).toBe('image/jpeg');
    expect(calls[0].url).toBe('https://kieai.redpandaai.co/api/file-base64-upload');
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.base64Data).toBe('data:image/jpeg;base64,aGVsbG8='); // raw b64 wrapped as data URI
    expect(body.uploadPath).toBe('images/user-upload'); // default
    expect(body.fileName).toBe('x.jpg');
  });

  test('kie_upload requires one of path/base64/url', async () => {
    const { server } = setupServer([]);
    await expect(callTool(server, 'kie_upload', {})).rejects.toThrow(
      /requires one of: path, base64, or url/,
    );
  });

  test('kie_image dispatches nano-banana-2 to /jobs/createTask with unified body', async () => {
    const { server, calls } = setupServer([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_nb_1' } } },
    ]);
    const result = await callTool(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'a serene mountain at dawn', resolution: '2K' },
      wait: false,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task_id).toBe('tsk_nb_1');
    expect(parsed.model).toBe('nano-banana-2');
    expect(parsed.endpoint_family).toBe('unified');
    expect(parsed.estimated_cost_usd).toBeCloseTo(0.06, 3); // 12 credits * 0.005
    expect(calls[0].url).toBe('https://api.test.kie.ai/api/v1/jobs/createTask');
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.model).toBe('nano-banana-2');
    expect(body.input.prompt).toBe('a serene mountain at dawn');
  });

  test('kie_video dispatches veo3 to /veo/generate (legacy family)', async () => {
    const { server, calls } = setupServer([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_veo_1' } } },
    ]);
    const result = await callTool(server, 'kie_video', {
      model: 'veo3',
      input: { prompt: 'a sunset over Bucharest', aspect_ratio: '16:9' },
      wait: false,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task_id).toBe('tsk_veo_1');
    expect(parsed.endpoint_family).toBe('veo');
    expect(parsed.estimated_cost_usd).toBe(2.0);
    expect(calls[0].url).toBe('https://api.test.kie.ai/api/v1/veo/generate');
  });

  test('kie_music dispatches suno-v5 to /generate', async () => {
    const { server, calls } = setupServer([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_suno_1' } } },
    ]);
    const result = await callTool(server, 'kie_music', {
      model: 'suno-v5',
      input: { prompt: 'an upbeat lo-fi piano track', instrumental: true },
      wait: false,
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.task_id).toBe('tsk_suno_1');
    expect(parsed.endpoint_family).toBe('suno');
    expect(calls[0].url).toBe('https://api.test.kie.ai/api/v1/generate');
  });

  test('kie_image rejects video model (cross-kind dispatch guard)', async () => {
    const { server } = setupServer([]);
    await expect(
      callTool(server, 'kie_image', {
        model: 'veo3',
        input: { prompt: 'x' },
      }),
    ).rejects.toThrow(/kind=video, not accepted by kie_image/);
  });

  test('kie_image rejects unknown model', async () => {
    const { server } = setupServer([]);
    await expect(
      callTool(server, 'kie_image', {
        model: 'imaginary-future-model-9000',
        input: { prompt: 'x' },
      }),
    ).rejects.toThrow(/unknown model/);
  });

  test('kie_image rejects invalid input per Zod schema', async () => {
    const { server } = setupServer([]);
    await expect(
      callTool(server, 'kie_image', {
        model: 'nano-banana-2',
        input: { prompt: '', resolution: '8K' },
      }),
    ).rejects.toThrow();
  });

  test('kie_image with image_input passes editing array through', async () => {
    const { server, calls } = setupServer([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_edit' } } },
    ]);
    await callTool(server, 'kie_image', {
      model: 'nano-banana-2',
      input: {
        prompt: 'restyle this',
        image_input: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      },
      wait: false,
    });
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.input.image_input).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
  });

  test('kie_status polls correct endpoint for veo task', async () => {
    const { server, calls } = setupServer([
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_veo_status',
            successFlag: 1,
            response: { resultUrls: ['https://cdn.kie.ai/x.mp4'] },
          },
        },
      },
    ]);
    const result = await callTool(server, 'kie_status', {
      task_id: 'tsk_veo_status',
      model: 'veo3',
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.state).toBe('success');
    expect(parsed.result_urls).toEqual(['https://cdn.kie.ai/x.mp4']);
    expect(calls[0].url).toContain('/veo/record-info');
    expect(calls[0].url).toContain('taskId=tsk_veo_status');
  });

  test('kie_models lists registry with kind filter', async () => {
    const { server } = setupServer([]);
    const result = await callTool(server, 'kie_models', { kind: 'video' });
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.every((m: { kind: string }) => m.kind === 'video')).toBe(true);
    const ids = parsed.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['veo3', 'veo3_fast', 'runway-aleph', 'seedance-2']));
  });

  test('registry sanity: all models route to a valid endpoint family', () => {
    const families = new Set(['unified', 'veo', 'runway', 'suno', 'gpt4o', 'elevenlabs']);
    for (const spec of Object.values(MODEL_REGISTRY)) {
      expect(families.has(spec.family)).toBe(true);
    }
  });

  test('cost estimator returns positive USD for every model', () => {
    for (const spec of Object.values(MODEL_REGISTRY)) {
      // dummy input that satisfies all required fields across schemas:
      const dummy = {
        prompt: 'x',
        text: 'x',
        voice_id: 'v1',
        resolution: '1K',
        duration: 5,
        nVariants: 1,
      } as Record<string, unknown>;
      const cost = spec.estimateCostUsd(dummy);
      expect(cost).toBeGreaterThan(0);
    }
  });
});
