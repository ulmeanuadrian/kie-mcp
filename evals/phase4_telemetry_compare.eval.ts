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

const tmpRoot = mkdtempSync(join(tmpdir(), 'kie-mcp-phase4-'));
afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* windows lock */
  }
});

interface Step {
  matchUrl?: RegExp;
  status: number;
  body?: unknown;
  binary?: Uint8Array;
  headers?: Record<string, string>;
}

function makeRoutedFetch(routes: Array<{ url: RegExp; responses: Step[] }>): {
  fetch: FetchLike & typeof fetch;
  callsByUrl: Map<string, number>;
} {
  const callsByUrl = new Map<string, number>();
  const idx = new Map<RegExp, number>();
  const fn = (async (url: string) => {
    callsByUrl.set(url, (callsByUrl.get(url) ?? 0) + 1);
    const route = routes.find((r) => r.url.test(url));
    if (!route) throw new Error(`no route for ${url}`);
    const i = idx.get(route.url) ?? 0;
    const step = route.responses[Math.min(i, route.responses.length - 1)];
    idx.set(route.url, i + 1);
    const headers = new Headers(step.headers ?? {});
    let body: ReadableStream<Uint8Array> | null = null;
    if (step.binary) {
      const b = step.binary;
      body = new ReadableStream({
        start(c) {
          c.enqueue(b);
          c.close();
        },
      });
    }
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      statusText: 'OK',
      headers,
      body,
      text: async () =>
        step.binary ? '' : step.body !== undefined ? JSON.stringify(step.body) : '',
    } as unknown as Response;
  }) as unknown as FetchLike & typeof fetch;
  return { fetch: fn, callsByUrl };
}

function setup(
  suffix: string,
  routes: Array<{ url: RegExp; responses: Step[] }>,
): {
  server: Server;
  callsByUrl: Map<string, number>;
  store: TaskStore;
} {
  const env: NodeJS.ProcessEnv = {
    KIE_API_KEY: 'sk-test',
    KIE_API_BASE: 'https://api.test.kie.ai/api/v1',
    KIE_DB_PATH: join(tmpRoot, `${suffix}.db`),
    KIE_OUTPUT_DIR: join(tmpRoot, `${suffix}-assets`),
    KIE_POLL_INTERVAL_MS: '10',
    KIE_POLL_MAX_MS: '2000',
  };
  const config = loadConfig(env);
  const { fetch, callsByUrl } = makeRoutedFetch(routes);
  const client = new KieClient(config, fetch);
  const store = new TaskStore(config.dbPath);
  const downloader = new AssetDownloader(config.outputDir, fetch);
  const tools = buildKieTools({ client, config, store, downloader });
  const server = buildServer(config, tools);
  return { server, callsByUrl, store };
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

function successUnifiedTask(taskId: string, url: string) {
  return {
    code: 200,
    msg: 'success',
    data: {
      taskId,
      state: 'success',
      resultJson: JSON.stringify({ resultUrls: [url] }),
      creditsConsumed: 8,
    },
  };
}

describe('Phase 4 — kie_compare + kie_cost_report', () => {
  test('kie_compare runs 3 models in parallel and aggregates', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { server } = setup('compare-3', [
      {
        url: /\/jobs\/createTask$/,
        responses: [
          { status: 200, body: { code: 200, msg: 'ok', data: { taskId: 'cmp_nb' } } },
          { status: 200, body: { code: 200, msg: 'ok', data: { taskId: 'cmp_flux' } } },
          { status: 200, body: { code: 200, msg: 'ok', data: { taskId: 'cmp_qwen' } } },
        ],
      },
      {
        url: /\/jobs\/recordInfo\?taskId=cmp_nb$/,
        responses: [{ status: 200, body: successUnifiedTask('cmp_nb', 'https://cdn.kie.ai/nb.png') }],
      },
      {
        url: /\/jobs\/recordInfo\?taskId=cmp_flux$/,
        responses: [
          { status: 200, body: successUnifiedTask('cmp_flux', 'https://cdn.kie.ai/flux.png') },
        ],
      },
      {
        url: /\/jobs\/recordInfo\?taskId=cmp_qwen$/,
        responses: [
          { status: 200, body: successUnifiedTask('cmp_qwen', 'https://cdn.kie.ai/qwen.png') },
        ],
      },
      {
        url: /https:\/\/cdn\.kie\.ai\/.*\.png$/,
        responses: [
          { status: 200, binary: png, headers: { 'content-type': 'image/png' } },
          { status: 200, binary: png, headers: { 'content-type': 'image/png' } },
          { status: 200, binary: png, headers: { 'content-type': 'image/png' } },
        ],
      },
    ]);

    const result = await call(server, 'kie_compare', {
      prompt: 'a serene mountain at dawn',
      models: ['nano-banana-2', 'flux-kontext-pro', 'qwen-image'],
    });

    expect(result.models_attempted).toBe(3);
    expect(result.models_succeeded).toBe(3);
    const results = result.results as Array<{ model: string; ok: boolean; cost_usd?: number }>;
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.model).sort()).toEqual([
      'flux-kontext-pro',
      'nano-banana-2',
      'qwen-image',
    ]);
    expect(Number(result.total_cost_usd)).toBeGreaterThan(0);
  });

  test('kie_compare rejects mixing kinds (image + video)', async () => {
    const { server } = setup('compare-bad', [
      { url: /./, responses: [{ status: 200, body: { code: 200, msg: 'unused' } }] },
    ]);
    await expect(
      call(server, 'kie_compare', {
        prompt: 'x',
        models: ['nano-banana-2', 'veo3'],
      }),
    ).rejects.toThrow(/share the same kind/);
  });

  test('kie_compare gracefully degrades: one model fails, others succeed', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { server } = setup('compare-partial', [
      {
        url: /\/jobs\/createTask$/,
        responses: [
          // first createTask success
          { status: 200, body: { code: 200, msg: 'ok', data: { taskId: 'cmp_ok' } } },
          // second createTask 4xx fail
          {
            status: 400,
            body: { code: 400, msg: 'invalid prompt for flux', data: null },
          },
        ],
      },
      {
        url: /\/jobs\/recordInfo\?taskId=cmp_ok$/,
        responses: [{ status: 200, body: successUnifiedTask('cmp_ok', 'https://cdn.kie.ai/ok.png') }],
      },
      {
        url: /https:\/\/cdn\.kie\.ai\/.*\.png$/,
        responses: [{ status: 200, binary: png, headers: { 'content-type': 'image/png' } }],
      },
    ]);

    const result = await call(server, 'kie_compare', {
      prompt: 'a mountain',
      models: ['nano-banana-2', 'flux-kontext-pro'],
    });

    expect(result.models_attempted).toBe(2);
    expect(result.models_succeeded).toBe(1);
    const results = result.results as Array<{ ok: boolean; error?: string }>;
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.error).toMatch(/invalid prompt/);
  });

  test('kie_cost_report aggregates by model across multiple calls', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const { server } = setup('cost-report', [
      {
        url: /\/jobs\/createTask$/,
        responses: [
          { status: 200, body: { code: 200, msg: 'ok', data: { taskId: 'cr_1' } } },
          { status: 200, body: { code: 200, msg: 'ok', data: { taskId: 'cr_2' } } },
          { status: 200, body: { code: 200, msg: 'ok', data: { taskId: 'cr_3' } } },
        ],
      },
      {
        url: /\/jobs\/recordInfo\?taskId=cr_1$/,
        responses: [{ status: 200, body: successUnifiedTask('cr_1', 'https://cdn.kie.ai/1.png') }],
      },
      {
        url: /\/jobs\/recordInfo\?taskId=cr_2$/,
        responses: [{ status: 200, body: successUnifiedTask('cr_2', 'https://cdn.kie.ai/2.png') }],
      },
      {
        url: /\/jobs\/recordInfo\?taskId=cr_3$/,
        responses: [{ status: 200, body: successUnifiedTask('cr_3', 'https://cdn.kie.ai/3.png') }],
      },
      {
        url: /https:\/\/cdn\.kie\.ai\/.*\.png$/,
        responses: [
          { status: 200, binary: png, headers: { 'content-type': 'image/png' } },
          { status: 200, binary: png, headers: { 'content-type': 'image/png' } },
          { status: 200, binary: png, headers: { 'content-type': 'image/png' } },
        ],
      },
    ]);

    // 2 nano-banana-2 + 1 qwen
    await call(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'cost1' },
      wait: true,
      download: true,
    });
    await call(server, 'kie_image', {
      model: 'nano-banana-2',
      input: { prompt: 'cost2' },
      wait: true,
      download: true,
    });
    await call(server, 'kie_image', {
      model: 'qwen-image',
      input: { prompt: 'cost3' },
      wait: true,
      download: true,
    });

    const report = await call(server, 'kie_cost_report', {});
    const total = Number(report.total_usd);
    // nano-banana-2 cost = 8 credits * 0.005 = 0.04 each → 0.08 for 2 calls
    // qwen-image cost = 8 credits * 0.005 = 0.04 (creditsConsumed from API; estimate was 0.02 but final uses real credits)
    expect(total).toBeCloseTo(0.12, 2);
    const byModel = report.by_model as Array<{ model: string; count: number; total_usd: number }>;
    const nb = byModel.find((r) => r.model === 'nano-banana-2');
    const qw = byModel.find((r) => r.model === 'qwen-image');
    expect(nb?.count).toBe(2);
    expect(qw?.count).toBe(1);
    expect(report.window).toBe('all-time');
  });

  test('kie_cost_report with hours window returns remaining_usd when budget set', async () => {
    const env: NodeJS.ProcessEnv = {
      KIE_API_KEY: 'sk-test',
      KIE_API_BASE: 'https://api.test.kie.ai/api/v1',
      KIE_DB_PATH: join(tmpRoot, 'budget-report.db'),
      KIE_OUTPUT_DIR: join(tmpRoot, 'budget-report-assets'),
      KIE_COST_BUDGET_USD: '5.00',
    };
    const config = loadConfig(env);
    const { fetch } = makeRoutedFetch([{ url: /./, responses: [{ status: 200, body: {} }] }]);
    const client = new KieClient(config, fetch);
    const store = new TaskStore(config.dbPath);
    const downloader = new AssetDownloader(config.outputDir, fetch);
    const tools = buildKieTools({ client, config, store, downloader });
    const server = buildServer(config, tools);

    const report = await call(server, 'kie_cost_report', { hours: 24 });
    expect(report.window).toBe('last 24h');
    expect(report.budget_usd).toBe(5);
    expect(report.remaining_usd).toBeCloseTo(5, 2);
  });
});
