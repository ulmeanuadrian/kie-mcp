import { KieClient } from './client.js';
import { EndpointSpec, NormalizedTaskStatus, TaskState } from './types.js';

export interface PollOptions {
  intervalMs: number;
  maxMs: number;
  signal?: AbortSignal;
  onTick?: (status: NormalizedTaskStatus, elapsedMs: number) => void;
}

const TERMINAL_STATES: ReadonlySet<TaskState> = new Set(['success', 'fail']);

export async function pollUntilTerminal(
  client: KieClient,
  endpoint: EndpointSpec,
  taskId: string,
  opts: PollOptions,
): Promise<NormalizedTaskStatus> {
  const startedAt = Date.now();
  let last: NormalizedTaskStatus | null = null;

  while (true) {
    if (opts.signal?.aborted) {
      throw new Error('polling aborted');
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed > opts.maxMs) {
      throw new Error(
        `polling timeout after ${opts.maxMs}ms (last state: ${last?.state ?? 'unknown'})`,
      );
    }

    const status = await client.getTaskStatus(endpoint, taskId);
    last = status;
    opts.onTick?.(status, elapsed);

    if (TERMINAL_STATES.has(status.state)) {
      return status;
    }

    await sleepWithSignal(opts.intervalMs, opts.signal);
  }
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error('polling aborted'));
    };
    const cleanup = () => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal?.aborted) {
      cleanup();
      reject(new Error('polling aborted'));
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
