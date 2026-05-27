import { Config } from './config.js';
import {
  CreateTaskResult,
  EndpointSpec,
  KieApiError,
  KieRequestOptions,
  KieTransientError,
  NormalizedTaskStatus,
  RawKieResponse,
} from './types.js';

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export class KieClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: Config,
    fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  ) {
    this.fetchImpl = fetchImpl;
  }

  async createTask(
    endpoint: EndpointSpec,
    model: string,
    input: Record<string, unknown>,
    callBackUrl?: string,
    options: KieRequestOptions = {},
  ): Promise<CreateTaskResult> {
    const body = endpoint.buildCreateBody(model, input, callBackUrl);
    const raw = await this.request<Record<string, unknown>>(
      'POST',
      endpoint.createPath,
      body,
      options,
    );
    const taskId = String((raw.data ?? {}).taskId ?? '');
    if (!taskId) {
      throw new KieApiError(
        200,
        raw.code,
        `kie.ai response missing taskId: ${raw.msg ?? 'no message'}`,
        raw,
      );
    }
    return { taskId };
  }

  async getTaskStatus(
    endpoint: EndpointSpec,
    taskId: string,
    options: KieRequestOptions = {},
  ): Promise<NormalizedTaskStatus> {
    const raw = await this.request<Record<string, unknown>>(
      'GET',
      endpoint.statusPath(taskId),
      undefined,
      options,
    );
    return endpoint.parseStatus(raw);
  }

  async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: KieRequestOptions = {},
  ): Promise<RawKieResponse<T>> {
    const url = `${this.config.apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      Accept: 'application/json',
    };
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }
    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const signal = options.signal
        ? mergeSignals(options.signal, controller.signal)
        : controller.signal;

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        });
        clearTimeout(timeoutId);

        const text = await response.text();
        let parsed: RawKieResponse<T>;
        try {
          parsed = text ? (JSON.parse(text) as RawKieResponse<T>) : ({ code: response.status, msg: '', data: null } as RawKieResponse<T>);
        } catch {
          throw new KieApiError(
            response.status,
            null,
            `kie.ai returned non-JSON body (${response.status}): ${text.slice(0, 200)}`,
          );
        }

        if (!response.ok) {
          if (RETRY_STATUS.has(response.status) && attempt < MAX_RETRIES - 1) {
            lastError = new KieTransientError(`HTTP ${response.status}: ${parsed.msg ?? text}`);
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new KieApiError(
            response.status,
            parsed.code ?? null,
            `kie.ai error (${response.status}): ${parsed.msg ?? 'unknown'}`,
            parsed,
          );
        }

        if (parsed.code && parsed.code !== 200) {
          throw new KieApiError(
            response.status,
            parsed.code,
            `kie.ai business error (code=${parsed.code}): ${parsed.msg ?? 'unknown'}`,
            parsed,
          );
        }

        return parsed;
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof KieApiError) throw err;
        if (err instanceof KieTransientError) {
          lastError = err;
          if (attempt < MAX_RETRIES - 1) {
            await sleep(backoffMs(attempt));
            continue;
          }
          throw err;
        }
        // network errors, timeouts, abort
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(backoffMs(attempt));
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new KieTransientError(`request failed after ${MAX_RETRIES} attempts: ${msg}`, err);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('unreachable: retry loop exited without resolution');
  }
}

function backoffMs(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (a.aborted || b.aborted) controller.abort();
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  return controller.signal;
}
