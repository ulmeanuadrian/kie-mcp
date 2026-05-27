import { z } from 'zod';

export type MediaKind = 'image' | 'video' | 'music' | 'speech' | 'sfx';

export type EndpointFamily = 'unified' | 'veo' | 'runway' | 'suno' | 'gpt4o' | 'elevenlabs';

export type TaskState = 'waiting' | 'queueing' | 'generating' | 'success' | 'fail';

export interface RawKieResponse<T = unknown> {
  code: number;
  msg: string;
  data: T | null;
}

export interface CreateTaskResult {
  taskId: string;
}

export interface NormalizedTaskStatus {
  taskId: string;
  state: TaskState;
  resultUrls: string[];
  errorCode?: string;
  errorMessage?: string;
  costTimeMs?: number;
  creditsConsumed?: number;
  raw: unknown;
}

export interface KieRequestOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export const TaskStateZ = z.enum(['waiting', 'queueing', 'generating', 'success', 'fail']);

export const HttpVerbZ = z.enum(['GET', 'POST']);

export interface EndpointSpec {
  family: EndpointFamily;
  createPath: string;
  statusPath: (taskId: string) => string;
  buildCreateBody: (model: string, input: Record<string, unknown>, callBackUrl?: string) => unknown;
  parseStatus: (raw: unknown) => NormalizedTaskStatus;
}

export interface ModelSpec {
  id: string;
  kind: MediaKind;
  family: EndpointFamily;
  description: string;
  inputSchema: z.ZodTypeAny;
  estimateCostUsd: (input: Record<string, unknown>) => number;
}

export class KieApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number | null,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'KieApiError';
  }
}

export class KieTransientError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'KieTransientError';
  }
}
