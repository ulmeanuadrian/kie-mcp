import {
  EndpointSpec,
  RawKieResponse,
  TaskState,
} from './types.js';

function tryParseJson(maybeJson: unknown): unknown {
  if (typeof maybeJson !== 'string') return maybeJson;
  if (!maybeJson.length) return null;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function extractUrls(obj: unknown): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const record = obj as Record<string, unknown>;
  const direct = record.resultUrls ?? record.result_urls ?? record.urls;
  if (Array.isArray(direct)) {
    return direct.filter((u): u is string => typeof u === 'string');
  }
  return [];
}

export const UNIFIED_ENDPOINT: EndpointSpec = {
  family: 'unified',
  createPath: '/jobs/createTask',
  statusPath: (id) => `/jobs/recordInfo?taskId=${encodeURIComponent(id)}`,
  buildCreateBody(model, input, callBackUrl) {
    return {
      model,
      input,
      ...(callBackUrl ? { callBackUrl } : {}),
    };
  },
  parseStatus(raw) {
    const wrapper = raw as RawKieResponse<Record<string, unknown>>;
    const data = wrapper.data ?? {};
    const state = (data.state as TaskState) ?? 'waiting';
    const resultObj = tryParseJson(data.resultJson);
    const urls = extractUrls(resultObj);
    return {
      taskId: String(data.taskId ?? ''),
      state,
      resultUrls: urls,
      errorCode: data.failCode ? String(data.failCode) : undefined,
      errorMessage: data.failMsg ? String(data.failMsg) : undefined,
      costTimeMs: typeof data.costTime === 'number' ? data.costTime : undefined,
      creditsConsumed:
        typeof data.creditsConsumed === 'number' ? data.creditsConsumed : undefined,
      raw,
    };
  },
};

export const VEO_ENDPOINT: EndpointSpec = {
  family: 'veo',
  createPath: '/veo/generate',
  statusPath: (id) => `/veo/record-info?taskId=${encodeURIComponent(id)}`,
  buildCreateBody(_model, input, callBackUrl) {
    return {
      ...input,
      ...(callBackUrl ? { callBackUrl } : {}),
    };
  },
  parseStatus(raw) {
    const wrapper = raw as RawKieResponse<Record<string, unknown>>;
    const data = wrapper.data ?? {};
    const flag = Number(data.successFlag ?? 0);
    const state: TaskState =
      flag === 1 ? 'success' : flag === 0 ? 'generating' : 'fail';
    const response = (data.response ?? data) as Record<string, unknown>;
    return {
      taskId: String(data.taskId ?? ''),
      state,
      resultUrls: extractUrls(response),
      errorMessage:
        typeof data.errorMessage === 'string'
          ? data.errorMessage
          : typeof response.errorMessage === 'string'
            ? response.errorMessage
            : undefined,
      raw,
    };
  },
};

export const RUNWAY_ENDPOINT: EndpointSpec = {
  family: 'runway',
  createPath: '/runway/generate',
  statusPath: (id) => `/runway/record-detail?taskId=${encodeURIComponent(id)}`,
  buildCreateBody(_model, input, callBackUrl) {
    return {
      ...input,
      ...(callBackUrl ? { callBackUrl } : {}),
    };
  },
  parseStatus(raw) {
    const wrapper = raw as RawKieResponse<Record<string, unknown>>;
    const data = wrapper.data ?? {};
    const stateRaw = String(data.state ?? '').toLowerCase();
    const state: TaskState =
      stateRaw === 'success'
        ? 'success'
        : stateRaw === 'fail'
          ? 'fail'
          : stateRaw === 'generating'
            ? 'generating'
            : stateRaw === 'queueing'
              ? 'queueing'
              : 'waiting';
    return {
      taskId: String(data.taskId ?? ''),
      state,
      resultUrls: extractUrls(data.response ?? data),
      errorMessage:
        typeof data.failMsg === 'string' ? data.failMsg : undefined,
      raw,
    };
  },
};

export const SUNO_ENDPOINT: EndpointSpec = {
  family: 'suno',
  createPath: '/generate',
  statusPath: (id) => `/generate/record-info?taskId=${encodeURIComponent(id)}`,
  buildCreateBody(_model, input, callBackUrl) {
    return {
      ...input,
      ...(callBackUrl ? { callBackUrl } : {}),
    };
  },
  parseStatus(raw) {
    const wrapper = raw as RawKieResponse<Record<string, unknown>>;
    const data = wrapper.data ?? {};
    const status = String(data.status ?? '').toUpperCase();
    const state: TaskState =
      status === 'SUCCESS' || status === 'FIRST_SUCCESS'
        ? 'success'
        : status.includes('FAIL')
          ? 'fail'
          : status === 'PENDING'
            ? 'generating'
            : 'waiting';
    const response = (data.response ?? {}) as Record<string, unknown>;
    const sunoData = Array.isArray(response.sunoData) ? response.sunoData : [];
    const urls = sunoData
      .map((track: unknown) =>
        typeof track === 'object' && track !== null
          ? String((track as Record<string, unknown>).audioUrl ?? '')
          : '',
      )
      .filter(Boolean);
    return {
      taskId: String(data.taskId ?? ''),
      state,
      resultUrls: urls,
      errorMessage:
        typeof data.errorMessage === 'string' ? data.errorMessage : undefined,
      raw,
    };
  },
};

export const GPT4O_ENDPOINT: EndpointSpec = {
  family: 'gpt4o',
  createPath: '/gpt4o-image/generate',
  statusPath: (id) => `/gpt4o-image/record-info?taskId=${encodeURIComponent(id)}`,
  buildCreateBody(_model, input, callBackUrl) {
    return {
      ...input,
      ...(callBackUrl ? { callBackUrl } : {}),
    };
  },
  parseStatus(raw) {
    const wrapper = raw as RawKieResponse<Record<string, unknown>>;
    const data = wrapper.data ?? {};
    const flag = Number(data.successFlag ?? 0);
    const state: TaskState =
      flag === 1 ? 'success' : flag === 0 ? 'generating' : 'fail';
    const response = (data.response ?? {}) as Record<string, unknown>;
    return {
      taskId: String(data.taskId ?? ''),
      state,
      resultUrls: extractUrls(response),
      errorMessage:
        typeof data.errorMessage === 'string' ? data.errorMessage : undefined,
      raw,
    };
  },
};

export const ENDPOINTS: Record<EndpointSpec['family'], EndpointSpec> = {
  unified: UNIFIED_ENDPOINT,
  veo: VEO_ENDPOINT,
  runway: RUNWAY_ENDPOINT,
  suno: SUNO_ENDPOINT,
  gpt4o: GPT4O_ENDPOINT,
  elevenlabs: UNIFIED_ENDPOINT,
};
