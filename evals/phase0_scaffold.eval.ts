import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';

describe('Phase 0 — scaffold eval', () => {
  const baseEnv: NodeJS.ProcessEnv = { KIE_API_KEY: 'sk-test-eval-key' };

  test('loadConfig accepts minimal env', () => {
    const config = loadConfig(baseEnv);
    expect(config.apiKey).toBe('sk-test-eval-key');
    expect(config.apiBase).toBe('https://api.kie.ai/api/v1');
    expect(config.timeoutMs).toBe(120_000);
    expect(config.outputDir).toMatch(/[\\/]\.kie-mcp[\\/]assets$/);
  });

  test('loadConfig rejects missing api key', () => {
    expect(() => loadConfig({})).toThrow(/KIE_API_KEY is required/);
  });

  test('loadConfig rejects malformed budget', () => {
    expect(() =>
      loadConfig({ ...baseEnv, KIE_COST_BUDGET_USD: 'banana' }),
    ).toThrow(/must be a number/);
  });

  test('buildServer returns Server with kie_health tool registered', async () => {
    const config = loadConfig(baseEnv);
    const server = buildServer(config);
    expect(server).toBeInstanceOf(Server);

    const handler = (server as unknown as {
      _requestHandlers: Map<string, (req: { params: { name?: string } }) => Promise<unknown>>;
    })._requestHandlers;
    expect(handler).toBeDefined();
  });

  test('kie_health tool returns expected payload', async () => {
    const config = loadConfig(baseEnv);
    const server = buildServer(config);

    type ToolList = { tools: Array<{ name: string; description: string }> };
    const listFn = lookupHandler(server, 'tools/list');
    const result = (await listFn({ method: 'tools/list', params: {} })) as ToolList;
    expect(result.tools.some((t) => t.name === 'kie_health')).toBe(true);

    const callFn = lookupHandler(server, 'tools/call');
    const callResult = (await callFn({
      method: 'tools/call',
      params: { name: 'kie_health', arguments: {} },
    })) as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(callResult.content[0].text);
    expect(parsed.package).toBe('@ulmeanua/kie-mcp');
    expect(parsed.api_key_set).toBe(true);
  });

  test('calling unknown tool throws MethodNotFound', async () => {
    const config = loadConfig(baseEnv);
    const server = buildServer(config);
    const callFn = lookupHandler(server, 'tools/call');
    await expect(
      callFn({ method: 'tools/call', params: { name: 'kie_imaginary', arguments: {} } }),
    ).rejects.toThrow(/tool not found/);
  });
});

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
