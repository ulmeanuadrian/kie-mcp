import { Config } from '../src/config.js';
import { KieClient } from '../src/client.js';
import { UNIFIED_ENDPOINT, VEO_ENDPOINT, SUNO_ENDPOINT } from '../src/endpoints.js';
import { KieApiError, KieTransientError } from '../src/types.js';

const baseConfig: Config = {
  apiKey: 'sk-test-eval-key',
  apiBase: 'https://api.test.kie.ai/api/v1',
  timeoutMs: 5_000,
  outputDir: '/tmp/kie',
  dbPath: '/tmp/kie/state.db',
  pollIntervalMs: 100,
  pollMaxMs: 5_000,
  costBudgetUsd: null,
};

function mockFetch(steps: Array<{ status: number; body: unknown }>): {
  fetch: typeof fetch;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      text: async () => (typeof step.body === 'string' ? step.body : JSON.stringify(step.body)),
    } as Response;
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe('Phase 1 — KieClient eval', () => {
  test('createTask via unified endpoint serializes body correctly', async () => {
    const { fetch, calls } = mockFetch([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_unified_001' } } },
    ]);
    const client = new KieClient(baseConfig, fetch);
    const result = await client.createTask(UNIFIED_ENDPOINT, 'nano-banana-2', {
      prompt: 'a serene mountain',
      aspect_ratio: '16:9',
    });
    expect(result.taskId).toBe('tsk_unified_001');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test.kie.ai/api/v1/jobs/createTask');
    expect(calls[0].init?.method).toBe('POST');
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body).toEqual({
      model: 'nano-banana-2',
      input: { prompt: 'a serene mountain', aspect_ratio: '16:9' },
    });
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test-eval-key');
  });

  test('createTask via veo legacy endpoint flattens body with model (no input wrapper)', async () => {
    const { fetch, calls } = mockFetch([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_veo_001' } } },
    ]);
    const client = new KieClient(baseConfig, fetch);
    await client.createTask(VEO_ENDPOINT, 'veo3', {
      prompt: 'a sunset',
      aspect_ratio: '16:9',
    });
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body).toEqual({ model: 'veo3', prompt: 'a sunset', aspect_ratio: '16:9' });
    expect(calls[0].url).toBe('https://api.test.kie.ai/api/v1/veo/generate');
  });

  test('veo endpoint lets explicit input.model override the dispatched id', async () => {
    const { fetch, calls } = mockFetch([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'tsk_veo_002' } } },
    ]);
    const client = new KieClient(baseConfig, fetch);
    await client.createTask(VEO_ENDPOINT, 'veo3', {
      prompt: 'a sunset',
      aspect_ratio: '9:16',
      model: 'veo3_fast',
    });
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body).toEqual({ model: 'veo3_fast', prompt: 'a sunset', aspect_ratio: '9:16' });
  });

  test('createTask retries on 503 then succeeds', async () => {
    const { fetch, calls } = mockFetch([
      { status: 503, body: { code: 503, msg: 'busy', data: null } },
      { status: 503, body: { code: 503, msg: 'busy', data: null } },
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'retry_ok' } } },
    ]);
    const client = new KieClient(baseConfig, fetch);
    const result = await client.createTask(UNIFIED_ENDPOINT, 'nano-banana-2', { prompt: 'x' });
    expect(result.taskId).toBe('retry_ok');
    expect(calls).toHaveLength(3);
  });

  test('createTask throws KieApiError on 400 without retry', async () => {
    const { fetch, calls } = mockFetch([
      { status: 400, body: { code: 400, msg: 'bad prompt', data: null } },
    ]);
    const client = new KieClient(baseConfig, fetch);
    await expect(
      client.createTask(UNIFIED_ENDPOINT, 'nano-banana-2', { prompt: '' }),
    ).rejects.toBeInstanceOf(KieApiError);
    expect(calls).toHaveLength(1);
  });

  test('createTask throws KieTransientError when all retries exhausted', async () => {
    const { fetch } = mockFetch([
      { status: 503, body: { code: 503, msg: 'busy', data: null } },
    ]);
    const client = new KieClient(baseConfig, fetch);
    await expect(
      client.createTask(UNIFIED_ENDPOINT, 'nano-banana-2', { prompt: 'x' }),
    ).rejects.toBeInstanceOf(KieApiError);
  });

  test('getTaskStatus parses unified success response with resultJson', async () => {
    const { fetch } = mockFetch([
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_unified_001',
            state: 'success',
            resultJson: JSON.stringify({ resultUrls: ['https://cdn.kie.ai/out.png'] }),
            costTime: 12_345,
            creditsConsumed: 8,
          },
        },
      },
    ]);
    const client = new KieClient(baseConfig, fetch);
    const status = await client.getTaskStatus(UNIFIED_ENDPOINT, 'tsk_unified_001');
    expect(status.state).toBe('success');
    expect(status.resultUrls).toEqual(['https://cdn.kie.ai/out.png']);
    expect(status.creditsConsumed).toBe(8);
    expect(status.costTimeMs).toBe(12_345);
  });

  test('getTaskStatus parses veo successFlag=1 as success', async () => {
    const { fetch } = mockFetch([
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_veo_001',
            successFlag: 1,
            response: { resultUrls: ['https://cdn.kie.ai/video.mp4'] },
          },
        },
      },
    ]);
    const client = new KieClient(baseConfig, fetch);
    const status = await client.getTaskStatus(VEO_ENDPOINT, 'tsk_veo_001');
    expect(status.state).toBe('success');
    expect(status.resultUrls).toEqual(['https://cdn.kie.ai/video.mp4']);
  });

  test('getTaskStatus parses suno SUCCESS with sunoData array', async () => {
    const { fetch } = mockFetch([
      {
        status: 200,
        body: {
          code: 200,
          msg: 'success',
          data: {
            taskId: 'tsk_suno_001',
            status: 'SUCCESS',
            response: {
              sunoData: [
                { audioUrl: 'https://cdn.kie.ai/a.mp3', duration: 120 },
                { audioUrl: 'https://cdn.kie.ai/b.mp3', duration: 130 },
              ],
            },
          },
        },
      },
    ]);
    const client = new KieClient(baseConfig, fetch);
    const status = await client.getTaskStatus(SUNO_ENDPOINT, 'tsk_suno_001');
    expect(status.state).toBe('success');
    expect(status.resultUrls).toEqual([
      'https://cdn.kie.ai/a.mp3',
      'https://cdn.kie.ai/b.mp3',
    ]);
  });

  test('createTask throws when business code is non-200 in success HTTP response', async () => {
    const { fetch } = mockFetch([
      { status: 200, body: { code: 401, msg: 'invalid api key', data: null } },
    ]);
    const client = new KieClient(baseConfig, fetch);
    await expect(
      client.createTask(UNIFIED_ENDPOINT, 'nano-banana-2', { prompt: 'x' }),
    ).rejects.toBeInstanceOf(KieApiError);
  });

  test('createTask passes idempotency key when supplied', async () => {
    const { fetch, calls } = mockFetch([
      { status: 200, body: { code: 200, msg: 'success', data: { taskId: 'id_ok' } } },
    ]);
    const client = new KieClient(baseConfig, fetch);
    await client.createTask(
      UNIFIED_ENDPOINT,
      'nano-banana-2',
      { prompt: 'x' },
      undefined,
      { idempotencyKey: 'abc-123' },
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('abc-123');
  });

  // sanity check on KieTransientError class
  test('KieTransientError preserves cause', () => {
    const cause = new Error('socket hang up');
    const err = new KieTransientError('wrap', cause);
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('KieTransientError');
  });
});
