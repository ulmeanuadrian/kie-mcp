import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Config } from './config.js';
import { KieClient } from './client.js';
import { AssetDownloader, DownloadResult } from './downloader.js';
import { pollUntilTerminal } from './poller.js';
import { hashIdempotency, TaskStore } from './store.js';
import { getEndpointFor, listModelsByKind, MODEL_REGISTRY } from './registry.js';
import { MediaKind, ModelSpec, NormalizedTaskStatus } from './types.js';
import { ToolHandler } from './server.js';

interface ToolCtx {
  client: KieClient;
  config: Config;
  store: TaskStore;
  downloader: AssetDownloader;
}

function modelListFor(kind: MediaKind | 'sfx'): string {
  return listModelsByKind(kind)
    .map((m) => `${m.id} — ${m.description}`)
    .join(' | ');
}

interface SubmitResult {
  task_id: string;
  model: string;
  kind: string;
  endpoint_family: string;
  estimated_cost_usd: number;
  state: string;
  result_urls?: string[];
  asset_paths?: string[];
  credits_consumed?: number;
  cost_usd?: number;
  cost_time_ms?: number;
  cache_hit?: boolean;
  status_hint?: string;
  error?: { code?: string; message?: string };
}

async function executeSubmission(
  ctx: ToolCtx,
  spec: ModelSpec,
  validatedInput: Record<string, unknown>,
  callBackUrl: string | undefined,
  wait: boolean,
  download: boolean,
): Promise<SubmitResult> {
  const idempotencyKey = hashIdempotency(spec.id, validatedInput);
  const existing = ctx.store.findByIdempotencyKey(idempotencyKey);
  if (existing && existing.state === 'success' && download) {
    return {
      task_id: existing.task_id,
      model: existing.model,
      kind: spec.kind,
      endpoint_family: existing.family,
      estimated_cost_usd: existing.cost_usd ?? 0,
      state: existing.state,
      result_urls: safeParseArray(existing.result_urls),
      asset_paths: safeParseArray(existing.asset_paths),
      cost_usd: existing.cost_usd ?? undefined,
      cache_hit: true,
    };
  }

  const endpoint = getEndpointFor(spec);
  const estimatedCost = Number(spec.estimateCostUsd(validatedInput).toFixed(4));

  if (ctx.config.costBudgetUsd !== null) {
    const sessionStartHint = Date.now() - 24 * 60 * 60 * 1000;
    const spent = ctx.store.totalCostUsd(sessionStartHint);
    if (spent + estimatedCost > ctx.config.costBudgetUsd) {
      throw new Error(
        `cost budget exceeded: spent $${spent.toFixed(2)} + estimate $${estimatedCost.toFixed(2)} > budget $${ctx.config.costBudgetUsd.toFixed(2)}`,
      );
    }
  }

  const { taskId } = await ctx.client.createTask(
    endpoint,
    spec.id,
    validatedInput,
    callBackUrl,
    { idempotencyKey },
  );

  ctx.store.insert({
    task_id: taskId,
    model: spec.id,
    family: spec.family,
    state: 'waiting',
    result_urls: '[]',
    asset_paths: '[]',
    credits_consumed: null,
    cost_usd: estimatedCost,
    error_code: null,
    error_message: null,
    idempotency_key: idempotencyKey,
  });

  if (!wait) {
    return {
      task_id: taskId,
      model: spec.id,
      kind: spec.kind,
      endpoint_family: spec.family,
      estimated_cost_usd: estimatedCost,
      state: 'waiting',
      status_hint: `Call kie_wait or kie_status with task_id="${taskId}" + model="${spec.id}" to retrieve.`,
    };
  }

  const finalStatus = await pollUntilTerminal(ctx.client, endpoint, taskId, {
    intervalMs: ctx.config.pollIntervalMs,
    maxMs: ctx.config.pollMaxMs,
  });

  return finalize(ctx, spec, taskId, estimatedCost, finalStatus, download);
}

async function finalize(
  ctx: ToolCtx,
  spec: ModelSpec,
  taskId: string,
  estimatedCost: number,
  status: NormalizedTaskStatus,
  download: boolean,
): Promise<SubmitResult> {
  let assetPaths: string[] = [];
  if (download && status.state === 'success' && status.resultUrls.length) {
    const results: DownloadResult[] = await ctx.downloader.downloadAll(
      status.resultUrls,
      taskId,
    );
    assetPaths = results.map((r) => r.path);
  }

  const finalCostUsd =
    typeof status.creditsConsumed === 'number'
      ? Number((status.creditsConsumed * 0.005).toFixed(4))
      : estimatedCost;

  ctx.store.update(taskId, {
    state: status.state,
    result_urls: JSON.stringify(status.resultUrls),
    asset_paths: JSON.stringify(assetPaths),
    credits_consumed: status.creditsConsumed ?? null,
    cost_usd: finalCostUsd,
    error_code: status.errorCode ?? null,
    error_message: status.errorMessage ?? null,
  });

  return {
    task_id: taskId,
    model: spec.id,
    kind: spec.kind,
    endpoint_family: spec.family,
    estimated_cost_usd: estimatedCost,
    state: status.state,
    result_urls: status.resultUrls,
    asset_paths: assetPaths,
    credits_consumed: status.creditsConsumed,
    cost_usd: finalCostUsd,
    cost_time_ms: status.costTimeMs,
    error: status.errorMessage
      ? { code: status.errorCode, message: status.errorMessage }
      : undefined,
  };
}

function safeParseArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function buildSubmitTool(
  name: string,
  kindLabel: string,
  acceptedKinds: ReadonlyArray<MediaKind>,
  ctx: ToolCtx,
): ToolHandler {
  const acceptedModels = Object.values(MODEL_REGISTRY).filter((m) =>
    acceptedKinds.includes(m.kind),
  );
  const modelIds = acceptedModels.map((m) => m.id);
  const hintModels = modelListFor(acceptedKinds[0]);

  return {
    name,
    description: `Generate ${kindLabel} via kie.ai. By default waits for the task to finish and downloads the asset locally; returns asset_paths. Set wait:false for async (returns task_id only). Models: ${hintModels}`,
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', enum: modelIds },
        input: {
          type: 'object',
          description: 'Model-specific input. See kie.ai docs for fields per model.',
        },
        wait: {
          type: 'boolean',
          description: 'If true (default), poll until success/fail and download asset.',
          default: true,
        },
        download: {
          type: 'boolean',
          description: 'If true (default), download result URLs to KIE_OUTPUT_DIR.',
          default: true,
        },
        callBackUrl: { type: 'string', format: 'uri' },
      },
      required: ['model', 'input'],
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({
          model: z.string().min(1),
          input: z.record(z.unknown()),
          wait: z.boolean().optional().default(true),
          download: z.boolean().optional().default(true),
          callBackUrl: z.string().url().optional(),
        })
        .parse(args);

      const spec = MODEL_REGISTRY[parsed.model];
      if (!spec) throw new Error(`unknown model: ${parsed.model}`);
      if (!acceptedKinds.includes(spec.kind)) {
        throw new Error(
          `model ${parsed.model} is kind=${spec.kind}, not accepted by ${name} (expects ${acceptedKinds.join('|')})`,
        );
      }
      const validatedInput = spec.inputSchema.parse(parsed.input) as Record<string, unknown>;
      return executeSubmission(
        ctx,
        spec,
        validatedInput,
        parsed.callBackUrl,
        parsed.wait,
        parsed.download,
      );
    },
  };
}

function buildStatusTool(ctx: ToolCtx): ToolHandler {
  return {
    name: 'kie_status',
    description: 'Get current status of a kie.ai task by id (does not wait).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1 },
        model: { type: 'string', enum: Object.keys(MODEL_REGISTRY) },
      },
      required: ['task_id', 'model'],
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({ task_id: z.string().min(1), model: z.string().min(1) })
        .parse(args);
      const spec = MODEL_REGISTRY[parsed.model];
      if (!spec) throw new Error(`unknown model: ${parsed.model}`);
      const endpoint = getEndpointFor(spec);
      const status = await ctx.client.getTaskStatus(endpoint, parsed.task_id);
      return {
        task_id: status.taskId,
        state: status.state,
        result_urls: status.resultUrls,
        credits_consumed: status.creditsConsumed,
        cost_time_ms: status.costTimeMs,
        error: status.errorMessage
          ? { code: status.errorCode, message: status.errorMessage }
          : undefined,
      };
    },
  };
}

function buildWaitTool(ctx: ToolCtx): ToolHandler {
  return {
    name: 'kie_wait',
    description:
      'Wait for an existing kie.ai task to reach a terminal state (success/fail). Downloads asset if successful. Use when you submitted with wait:false and want to retrieve later.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1 },
        model: { type: 'string', enum: Object.keys(MODEL_REGISTRY) },
        download: { type: 'boolean', default: true },
        timeout_ms: { type: 'number', minimum: 1000 },
      },
      required: ['task_id', 'model'],
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({
          task_id: z.string().min(1),
          model: z.string().min(1),
          download: z.boolean().optional().default(true),
          timeout_ms: z.number().int().positive().optional(),
        })
        .parse(args);
      const spec = MODEL_REGISTRY[parsed.model];
      if (!spec) throw new Error(`unknown model: ${parsed.model}`);
      const endpoint = getEndpointFor(spec);

      const finalStatus = await pollUntilTerminal(ctx.client, endpoint, parsed.task_id, {
        intervalMs: ctx.config.pollIntervalMs,
        maxMs: parsed.timeout_ms ?? ctx.config.pollMaxMs,
      });

      const existing = ctx.store.get(parsed.task_id);
      const estimatedCost = existing?.cost_usd ?? 0;
      return finalize(ctx, spec, parsed.task_id, estimatedCost, finalStatus, parsed.download);
    },
  };
}

function buildAssetsTool(ctx: ToolCtx): ToolHandler {
  return {
    name: 'kie_assets',
    description:
      'List downloaded kie.ai assets. Optional filters by model or state. Returns task_id, model, state, asset_paths, cost.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', enum: Object.keys(MODEL_REGISTRY) },
        state: { type: 'string', enum: ['waiting', 'queueing', 'generating', 'success', 'fail'] },
        limit: { type: 'number', minimum: 1, maximum: 500, default: 50 },
      },
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({
          model: z.string().optional(),
          state: z.enum(['waiting', 'queueing', 'generating', 'success', 'fail']).optional(),
          limit: z.number().int().min(1).max(500).optional().default(50),
        })
        .parse(args);
      const rows = ctx.store.list({ state: parsed.state, limit: parsed.limit });
      const filtered = parsed.model ? rows.filter((r) => r.model === parsed.model) : rows;
      return filtered.map((r) => ({
        task_id: r.task_id,
        model: r.model,
        family: r.family,
        state: r.state,
        result_urls: safeParseArray(r.result_urls),
        asset_paths: safeParseArray(r.asset_paths),
        credits_consumed: r.credits_consumed,
        cost_usd: r.cost_usd,
        created_at: new Date(r.created_at).toISOString(),
        updated_at: new Date(r.updated_at).toISOString(),
        error: r.error_message
          ? { code: r.error_code ?? undefined, message: r.error_message }
          : undefined,
      }));
    },
  };
}

function buildModelsTool(): ToolHandler {
  return {
    name: 'kie_models',
    description: 'List all registered kie.ai models with kind, endpoint family, and description.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['image', 'video', 'music', 'speech', 'sfx'] },
      },
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({ kind: z.enum(['image', 'video', 'music', 'speech', 'sfx']).optional() })
        .parse(args);
      const all = Object.values(MODEL_REGISTRY);
      const filtered = parsed.kind ? all.filter((m) => m.kind === parsed.kind) : all;
      return filtered.map((m) => ({
        id: m.id,
        kind: m.kind,
        family: m.family,
        description: m.description,
      }));
    },
  };
}

const COMPARE_CONCURRENCY = 4;

function buildCompareTool(ctx: ToolCtx): ToolHandler {
  return {
    name: 'kie_compare',
    description:
      'Run the same prompt across multiple kie.ai models in parallel and return a grid of results. Max 4 concurrent. Useful for "show me Flux vs Nano Banana vs GPT Image 2" style picking.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1 },
        models: {
          type: 'array',
          items: { type: 'string', enum: Object.keys(MODEL_REGISTRY) },
          minItems: 2,
          maxItems: 8,
        },
        extra_input: {
          type: 'object',
          description: 'Additional input merged with {prompt} into each model call (e.g. aspect_ratio).',
        },
        wait: { type: 'boolean', default: true },
        download: { type: 'boolean', default: true },
      },
      required: ['prompt', 'models'],
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({
          prompt: z.string().min(1),
          models: z.array(z.string()).min(2).max(8),
          extra_input: z.record(z.unknown()).optional(),
          wait: z.boolean().optional().default(true),
          download: z.boolean().optional().default(true),
        })
        .parse(args);

      const specs: ModelSpec[] = [];
      for (const id of parsed.models) {
        const s = MODEL_REGISTRY[id];
        if (!s) throw new Error(`unknown model: ${id}`);
        specs.push(s);
      }
      const kinds = new Set(specs.map((s) => s.kind));
      if (kinds.size > 1) {
        throw new Error(
          `kie_compare requires all models to share the same kind; got: ${[...kinds].join(', ')}`,
        );
      }

      // Build per-model validated input (each model may accept slightly different param shape)
      const tasks = specs.map((spec) => {
        const rawInput = { prompt: parsed.prompt, ...(parsed.extra_input ?? {}) };
        const validated = safeValidate(spec, rawInput);
        return { spec, validated };
      });

      const results: Array<Record<string, unknown>> = [];
      for (let i = 0; i < tasks.length; i += COMPARE_CONCURRENCY) {
        const slice = tasks.slice(i, i + COMPARE_CONCURRENCY);
        const settled = await Promise.allSettled(
          slice.map(({ spec, validated }) =>
            executeSubmission(ctx, spec, validated, undefined, parsed.wait, parsed.download),
          ),
        );
        for (let j = 0; j < settled.length; j++) {
          const r = settled[j];
          const spec = slice[j].spec;
          if (r.status === 'fulfilled') {
            results.push({ ...r.value, model: spec.id, ok: true });
          } else {
            results.push({
              model: spec.id,
              ok: false,
              error: r.reason instanceof Error ? r.reason.message : String(r.reason),
            });
          }
        }
      }

      const totalCost = results
        .filter((r) => r.ok)
        .reduce((acc, r) => acc + Number((r as { cost_usd?: number }).cost_usd ?? 0), 0);

      return {
        prompt: parsed.prompt,
        models_attempted: parsed.models.length,
        models_succeeded: results.filter((r) => r.ok).length,
        total_cost_usd: Number(totalCost.toFixed(4)),
        results,
      };
    },
  };
}

function safeValidate(spec: ModelSpec, input: Record<string, unknown>): Record<string, unknown> {
  try {
    return spec.inputSchema.parse(input) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`input invalid for model ${spec.id}: ${msg}`);
  }
}

function buildCostReportTool(ctx: ToolCtx): ToolHandler {
  return {
    name: 'kie_cost_report',
    description:
      'Show cost telemetry. Aggregates total $ spent and per-model breakdown. Optional window in hours.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: {
          type: 'number',
          minimum: 0.1,
          maximum: 8760,
          description: 'Look back N hours. Omit for all-time total.',
        },
      },
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z.object({ hours: z.number().positive().optional() }).parse(args);
      const sinceMs = parsed.hours ? Date.now() - parsed.hours * 3_600_000 : undefined;
      const total = ctx.store.totalCostUsd(sinceMs);
      const byModel = ctx.store.costByModel(sinceMs);
      return {
        window: parsed.hours ? `last ${parsed.hours}h` : 'all-time',
        total_usd: Number(total.toFixed(4)),
        budget_usd: ctx.config.costBudgetUsd,
        remaining_usd:
          ctx.config.costBudgetUsd !== null
            ? Number((ctx.config.costBudgetUsd - total).toFixed(4))
            : null,
        by_model: byModel.map((r) => ({
          model: r.model,
          count: r.count,
          total_usd: Number(r.total_usd.toFixed(4)),
        })),
      };
    },
  };
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

// kie.ai upload accepts generous sizes, but guard against accidental huge payloads.
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

function sanitizeFileName(name: string): string {
  return basename(name).replace(/[^\w.\-]/g, '_') || 'upload';
}

function buildUploadTool(ctx: ToolCtx): ToolHandler {
  return {
    name: 'kie_upload',
    description:
      "Upload a local file (or base64/data URI) to kie.ai and return a public download URL usable in image_input / video reference fields. kie.ai's generation tools require PUBLIC http(s) URLs — local paths, file:// and data: URIs are rejected by the generation API. Use this first when you have a local reference image. If you pass an already-public http(s) url, it is returned as-is (passthrough).",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Local file path to read and upload.' },
        base64: {
          type: 'string',
          description: 'Raw base64 or a full data: URI to upload directly (instead of path).',
        },
        url: {
          type: 'string',
          description: 'An already-public http(s) URL — returned as-is (passthrough convenience).',
        },
        file_name: { type: 'string', description: 'Override the stored file name.' },
        upload_path: {
          type: 'string',
          description: 'Remote folder prefix (default "images/user-upload").',
        },
      },
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({
          path: z.string().min(1).optional(),
          base64: z.string().min(1).optional(),
          url: z.string().url().optional(),
          file_name: z.string().min(1).optional(),
          upload_path: z.string().min(1).optional().default('images/user-upload'),
        })
        .parse(args);

      if (parsed.url) {
        return { url: parsed.url, passthrough: true };
      }
      if (!parsed.path && !parsed.base64) {
        throw new Error('kie_upload requires one of: path, base64, or url');
      }

      let dataUri: string;
      let fileName: string;
      let sizeBytes: number | undefined;

      if (parsed.path) {
        const buf = await readFile(parsed.path);
        if (buf.byteLength > UPLOAD_MAX_BYTES) {
          throw new Error(
            `file too large: ${buf.byteLength} bytes > ${UPLOAD_MAX_BYTES} (resize before upload)`,
          );
        }
        sizeBytes = buf.byteLength;
        const ext = extname(parsed.path).toLowerCase();
        const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
        dataUri = `data:${mime};base64,${buf.toString('base64')}`;
        fileName = sanitizeFileName(parsed.file_name ?? parsed.path);
      } else {
        const b64 = parsed.base64!;
        dataUri = b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
        fileName = sanitizeFileName(parsed.file_name ?? 'upload.jpg');
      }

      const res = await ctx.client.uploadBase64(dataUri, fileName, parsed.upload_path);
      return {
        url: res.url,
        file_name: fileName,
        size_bytes: res.size_bytes ?? sizeBytes,
        mime_type: res.mime_type,
      };
    },
  };
}

export function buildKieTools(ctx: ToolCtx): ToolHandler[] {
  return [
    buildSubmitTool('kie_image', 'image', ['image'], ctx),
    buildSubmitTool('kie_video', 'video', ['video'], ctx),
    buildSubmitTool('kie_music', 'music', ['music'], ctx),
    buildSubmitTool('kie_speech', 'speech/sfx', ['speech', 'sfx'], ctx),
    buildCompareTool(ctx),
    buildUploadTool(ctx),
    buildWaitTool(ctx),
    buildStatusTool(ctx),
    buildAssetsTool(ctx),
    buildCostReportTool(ctx),
    buildModelsTool(),
  ];
}
