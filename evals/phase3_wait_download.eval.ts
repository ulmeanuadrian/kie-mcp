import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { KieClient, FetchLike } from '../src/client.js';
import { buildServer } from '../src/server.js';
import { buildKieTools } from '../src/tools.js';
import { TaskStore, hashIdempotency } from '../src/store.js';
import { AssetDownloader } from '../src/downloader.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { pollUntilTerminal } from '../src/poller.js';
import { UNIFIED_ENDPOINT } from '../src/endpoints.js';

const tmpRoot = mkdtempSync(join(tmpdir(), 'kie-mcp-phase3-'));
afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Windows may hold SQLite locks past suite end; OS cleans up Temp later
  }
});

function baseEnv(suffix: string): NodeJS.ProcessEnv {
  return {
    KIE_API_KEY: 'sk-test',
    KIE_API_BASE: 'https://api.test.kie.ai/api/v1',
    KIE_DB_PATH: join(tmpRoot, `${suffix}.db`),
    KIE_OUTPUT_DIR: join(tmpRoot, `${suffix}-assets`),
    KIE_POLL_INTERVAL_MS: '20',
    KIE_POLL_MAX_MS: '2000',
  };
}

interface MockStep {
  status: number;
  body?: unknown;
  bodyText?: string;
  headers?: Record<string, string>;
  binary?: Uint8Array;
}

function makeFetch(steps: MockStep[]): {
  fetch: FetchLike & typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    const headers = new Headers(step.headers ?? {});
    const text = step.bodyText
      ? step.bodyText
      : step.body !== undefined
        ? JSON.stringify(step.body)
        : '';
    let body: ReadableStream<Uint8Array> | null = null;
    if (step.binary) {
      const bytes = step.binary;
      body = new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    }
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      statusText: step.status >= 200 && step.status < 300 ? 'OK' : 'Error',
      headers,
      body,
      text: async () => text,
    } as unknown as Response;
  }) as unknown as FetchLike & typeof fetch;
  return { fetch: fn, calls };
}

function setup(suffix: string, steps: MockStep[]): {
  server: Server;
  calls: Array<{ url: string; init?: RequestInit }>;
  store: TaskStore;
  outputDir: string;
} {
  const env = baseEnv(suffix);
  const config = loadConfig(env);
  const { fetch, calls } = makeFetch(steps);
  const client = new KieClient(config, fetch);
  const store = new TaskStore(config.dbPath);
  const downloader = new AssetDownloader(config.outputDir, fetch);
  const tools = buildKieTools({ client, config, store, downloader });
  const server = buildServer(config, tools);
  return { server, calls, store, outputDir: config.outputDir };
}

function lookup(
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
  if (!fn) throw new Error(`no handler for ${method}`);
  return fn;
}

async function call(
  server: Server,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fn = lookup(server, 'tools/call');
  const r = (await fn({ method: 'tools/call', params: { name, arguments: args } })) as {
    content: Array<{ type: string; text: string }>;
  };
  return JSON.parse(r.content[0].text);
}

describe('Phase 3 — sync-wait + auto-download + idempotency', () => {
  test('pollUntilTerminal cycles through generating → success', async () => {
    const { fetch } = makeFetch([
      {
        status: 200,
        body: { code: 200, msg: 'success', data: { taskId: 't1', state: 'generating' } },
      },
      {
        status: 200,
        body: { code: 200, msg: 'success', data: { taskId: 't1', state: 'generating' } },
      },
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 't1',
            state: 'success',
            resultJson: JSON.stringify({ resultUrls: ['https://cdn.kie.ai/done.png'] }),
            creditsConsumed: 8,
          },
        },
      },
    ]);
    const config = loadConfig(baseEnv('poll-only'));
    const client = new KieClient(config, fetch);
    const ticks: string[] = [];
    const status = await pollUntilTerminal(client, UNIFIED_ENDPOINT, 't1', {
      intervalMs: 10,
      maxMs: 1000,
      onTick: (s) => ticks.push(s.state),
    });
    expect(status.state).toBe('success');
    expect(status.resultUrls).toEqual(['https://cdn.kie.ai/done.png']);
    expect(ticks).toEqual(['generating', 'generating', 'success']);
  });

  test('pollUntilTerminal times out and throws', async () => {
    const { fetch } = makeFetch([
      {
        status: 200,
        body: { code: 200, msg: 'success', data: { taskId: 't2', state: 'generating' } },
      },
    ]);
    const config = loadConfig(baseEnv('poll-timeout'));
    const client = new KieClient(config, fetch);
    await expect(
      pollUntilTerminal(client, UNIFIED_ENDPOINT, 't2', { intervalMs: 5, maxMs: 50 }),
    ).rejects.toThrow(/polling timeout/);
  });

  test('AssetDownloader writes file to outputDir with correct ext from URL', async () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    const { fetch } = makeFetch([
      { status: 200, binary: pngBytes, headers: { 'content-type': 'image/png' } },
    ]);
    const outDir = join(tmpRoot, 'dl-test');
    const dl = new AssetDownloader(outDir, fetch);
    const result = await dl.download('https://cdn.kie.ai/out.png', 'tsk_dl_1', 0);
    expect(result.path).toBe(join(outDir, 'tsk_dl_1.png'));
    expect(result.bytes).toBe(10);
    expect(result.fromCache).toBe(false);
    expect(existsSync(result.path)).toBe(true);
    const written = readFileSync(result.path);
    expect(written.length).toBe(10);
    expect(written[0]).toBe(0x89);
  });

  test('AssetDownloader returns fromCache=true on second call to same URL+task', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { fetch } = makeFetch([
      { status: 200, binary: pngBytes, headers: { 'content-type': 'image/png' } },
      { status: 200, binary: pngBytes, headers: { 'content-type': 'image/png' } },
    ]);
    const outDir = join(tmpRoot, 'dl-cache');
    const dl = new AssetDownloader(outDir, fetch);
    const r1 = await dl.download('https://cdn.kie.ai/cache.png', 'tsk_cache', 0);
    const r2 = await dl.download('https://cdn.kie.ai/cache.png', 'tsk_cache', 0);
    expect(r1.fromCache).toBe(false);
    expect(r2.fromCache).toBe(true);
    expect(r2.path).toBe(r1.path);
  });

  test('AssetDownloader infers ext from content-type when URL has no extension', async () => {
    const mp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const { fetch } = makeFetch([
      { status: 200, binary: mp4Bytes, headers: { 'content-type': 'video/mp4' } },
    ]);
    const outDir = join(tmpRoot, 'dl-ct');
    const dl = new AssetDownloader(outDir, fetch);
    const result = await dl.download('https://cdn.kie.ai/12345', 'tsk_ct', 0);
    expect(result.path).toMatch(/tsk_ct\.mp4$/);
  });

  test('hashIdempotency is deterministic across key order', () => {
    const a = hashIdempotency('m1', { a: 1, b: 2, c: 3 });
    const b = hashIdempotency('m1', { c: 3, b: 2, a: 1 });
    expect(a).toBe(b);
    const c = hashIdempotency('m1', { a: 1, b: 2 });
    expect(c).not.toBe(a);
    const d = hashIdempotency('m2', { a: 1, b: 2, c: 3 });
    expect(d).not.toBe(a);
  });

  test('TaskStore round-trips task, idempotency lookup works', () => {
    const dbPath = join(tmpRoot, 'store-rt.db');
    const store = new TaskStore(dbPath);
    store.insert({
      task_id: 'tsk_a',
      model: 'nano-banana-2',
      family: 'unified',
      state: 'waiting',
      result_urls: '[]',
      asset_paths: '[]',
      credits_consumed: null,
      cost_usd: 0.04,
      error_code: null,
      error_message: null,
      idempotency_key: 'nano-banana-2:abc',
    });
    const row = store.get('tsk_a');
    expect(row?.task_id).toBe('tsk_a');
    expect(row?.cost_usd).toBe(0.04);
    const byKey = store.findByIdempotencyKey('nano-banana-2:abc');
    expect(byKey?.task_id).toBe('tsk_a');
    store.update('tsk_a', { state: 'success', result_urls: JSON.stringify(['url1']) });
    const updated = store.get('tsk_a');
    expect(updated?.state).toBe('success');
    expect(updated?.result_urls).toBe('["url1"]');
    store.close();
  });

  test('kie_image with wait:true polls, downloads, returns asset_paths and persists to store', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { server, store, outputDir } = setup('e2e-img', [
      // createTask
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_e2e_1' } } },
      // poll 1: generating
      {
        status: 200,
        body: { code: 200, msg: 'success', data: { taskId: 'tsk_e2e_1', state: 'generating' } },
      },
      // poll 2: success
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_e2e_1',
            state: 'success',
            resultJson: JSON.stringify({ resultUrls: ['https://cdn.kie.ai/out.png'] }),
            creditsConsumed: 8,
            costTime: 4_321,
          },
        },
      },
      // download
      { status: 200, binary: pngBytes, headers: { 'content-type': 'image/png' } },
    ]);

    const result = await call(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'mountain dawn' },
      wait: true,
      download: true,
    });

    expect(result.state).toBe('success');
    expect(result.task_id).toBe('tsk_e2e_1');
    expect(Array.isArray(result.asset_paths)).toBe(true);
    const paths = result.asset_paths as string[];
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain(outputDir);
    expect(paths[0]).toMatch(/tsk_e2e_1\.png$/);
    expect(existsSync(paths[0])).toBe(true);
    expect(result.credits_consumed).toBe(8);
    expect(result.cost_usd).toBe(0.04);
    expect(result.cost_time_ms).toBe(4321);

    const row = store.get('tsk_e2e_1');
    expect(row?.state).toBe('success');
    expect(row?.cost_usd).toBe(0.04);
    store.close();
  });

  test('idempotency: second submit with identical input + model returns cache_hit', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { server } = setup('idem', [
      // 1st submit: createTask
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_idem_1' } } },
      // poll: success immediately
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_idem_1',
            state: 'success',
            resultJson: JSON.stringify({ resultUrls: ['https://cdn.kie.ai/i.png'] }),
            creditsConsumed: 8,
          },
        },
      },
      // download for 1st
      { status: 200, binary: pngBytes, headers: { 'content-type': 'image/png' } },
      // ANY further calls (none expected for 2nd submit — it should short-circuit)
      { status: 500, body: { code: 500, msg: 'should not be called', data: null } },
    ]);

    const first = await call(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'identical prompt for idem' },
      wait: true,
      download: true,
    });
    expect(first.state).toBe('success');
    expect(first.cache_hit).toBeUndefined();

    const second = await call(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'identical prompt for idem' },
      wait: true,
      download: true,
    });
    expect(second.cache_hit).toBe(true);
    expect(second.task_id).toBe(first.task_id);
    expect(second.asset_paths).toEqual(first.asset_paths);
  });

  test('kie_wait waits for an existing task and downloads', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { server } = setup('wait-tool', [
      // submit (wait:false)
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_wait_1' } } },
      // kie_wait poll: generating
      {
        status: 200,
        body: { code: 200, msg: 'success', data: { taskId: 'tsk_wait_1', state: 'generating' } },
      },
      // kie_wait poll: success
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_wait_1',
            state: 'success',
            resultJson: JSON.stringify({ resultUrls: ['https://cdn.kie.ai/wait.png'] }),
            creditsConsumed: 8,
          },
        },
      },
      // download
      { status: 200, binary: pngBytes, headers: { 'content-type': 'image/png' } },
    ]);

    const submitted = await call(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'kie_wait test' },
      wait: false,
    });
    expect(submitted.state).toBe('waiting');

    const waited = await call(server, 'kie_wait', {
      task_id: submitted.task_id as string,
      model: 'nano-banana-2',
    });
    expect(waited.state).toBe('success');
    const paths = waited.asset_paths as string[];
    expect(paths).toHaveLength(1);
    expect(existsSync(paths[0])).toBe(true);
  });

  test('kie_assets lists tasks by state filter', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { server } = setup('assets-list', [
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_ok' } } },
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_ok',
            state: 'success',
            resultJson: JSON.stringify({ resultUrls: ['https://cdn.kie.ai/ok.png'] }),
            creditsConsumed: 8,
          },
        },
      },
      { status: 200, binary: pngBytes, headers: { 'content-type': 'image/png' } },
    ]);
    await call(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'for assets list' },
      wait: true,
      download: true,
    });

    const list = (await call(server, 'kie_assets', { state: 'success' })) as Array<{
      task_id: string;
      asset_paths: string[];
    }>;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].task_id).toBe('tsk_ok');
    expect(list[0].asset_paths.length).toBe(1);
  });

  test('cost budget enforcement blocks call when exceeded', async () => {
    const env = {
      ...baseEnv('budget'),
      KIE_COST_BUDGET_USD: '0.10',
    };
    const config = loadConfig(env);
    const { fetch } = makeFetch([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_b1' } } },
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_b1',
            state: 'success',
            resultJson: JSON.stringify({ resultUrls: ['https://cdn.kie.ai/x.png'] }),
            creditsConsumed: 8,
          },
        },
      },
      { status: 200, binary: new Uint8Array([0x89]), headers: { 'content-type': 'image/png' } },
    ]);
    const client = new KieClient(config, fetch);
    const store = new TaskStore(config.dbPath);
    const downloader = new AssetDownloader(config.outputDir, fetch);
    const tools = buildKieTools({ client, config, store, downloader });
    const server = buildServer(config, tools);

    // First call: cost 0.04 USD → OK (under 0.10 budget)
    await call(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'budget-1' },
      wait: true,
      download: true,
    });

    // Second call: veo3 estimate 2.0 → exceeds 0.10 budget → should throw
    await expect(
      call(server, 'kie_video', {
        model: 'veo3',
        input: { prompt: 'expensive video' },
        wait: false,
      }),
    ).rejects.toThrow(/cost budget exceeded/);
  });
});
