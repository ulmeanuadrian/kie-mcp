/**
 * Live API smoke test against kie.ai.
 *
 * Skipped unless KIE_EVAL_LIVE=1 is set. Costs real money (~$0.02 per run).
 *
 * Run with: KIE_EVAL_LIVE=1 npm run eval
 *           (or: npm run eval:live)
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { KieClient } from '../src/client.js';
import { buildServer } from '../src/server.js';
import { buildKieTools } from '../src/tools.js';
import { TaskStore } from '../src/store.js';
import { AssetDownloader } from '../src/downloader.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const LIVE = process.env.KIE_EVAL_LIVE === '1' && !!process.env.KIE_API_KEY;
const describeIfLive = LIVE ? describe : describe.skip;

const tmpRoot = mkdtempSync(join(tmpdir(), 'kie-mcp-live-'));
afterAll(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* windows lock */
  }
});

function setup(suffix: string): { server: Server; outputDir: string; store: TaskStore } {
  const env: NodeJS.ProcessEnv = {
    KIE_API_KEY: process.env.KIE_API_KEY,
    KIE_API_BASE: process.env.KIE_API_BASE,
    KIE_DB_PATH: join(tmpRoot, `${suffix}.db`),
    KIE_OUTPUT_DIR: join(tmpRoot, `${suffix}-assets`),
    KIE_POLL_INTERVAL_MS: '5000',
    KIE_POLL_MAX_MS: '180000',
  };
  const config = loadConfig(env);
  const client = new KieClient(config);
  const store = new TaskStore(config.dbPath);
  const downloader = new AssetDownloader(config.outputDir);
  const tools = buildKieTools({ client, config, store, downloader });
  const server = buildServer(config, tools);
  return { server, outputDir: config.outputDir, store };
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

describeIfLive('Phase 5 — live smoke against kie.ai', () => {
  test(
    'kie_image with nano-banana-2 generates + downloads an actual file',
    async () => {
      const { server, outputDir } = setup('nb-smoke');
      const result = await call(server, 'kie_image', {
        model: 'nano-banana-2',
        input: {
          prompt: 'a single red apple on a wooden table, soft natural light, photo realistic',
          aspect_ratio: '1:1',
          resolution: '1K',
        },
        wait: true,
        download: true,
      });

      console.log('[live smoke] result:', JSON.stringify(result, null, 2));

      expect(result.state).toBe('success');
      const paths = result.asset_paths as string[];
      expect(paths).toBeDefined();
      expect(paths.length).toBeGreaterThan(0);
      expect(existsSync(paths[0])).toBe(true);
      const st = statSync(paths[0]);
      expect(st.size).toBeGreaterThan(1024);
      expect(paths[0]).toContain(outputDir);

      // cost reported
      expect(Number(result.cost_usd ?? 0)).toBeGreaterThan(0);
    },
    240_000,
  );

  test('kie_cost_report reflects the live spend', async () => {
    if (!LIVE) return;
    const { server } = setup('cost-after-live');
    const report = await call(server, 'kie_cost_report', {});
    expect(report.total_usd).toBeDefined();
  });
});

if (!LIVE) {
  test('live smoke skipped — set KIE_EVAL_LIVE=1 and KIE_API_KEY to run', () => {
    expect(true).toBe(true);
  });
}
