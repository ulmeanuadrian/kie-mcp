import { z } from 'zod';
import { Config } from './config.js';
import { KieClient } from './client.js';
import { getEndpointFor, listModelsByKind, MODEL_REGISTRY } from './registry.js';
import { MediaKind } from './types.js';
import { ToolHandler } from './server.js';

interface ToolCtx {
  client: KieClient;
  config: Config;
}

function modelListFor(kind: MediaKind | 'sfx'): string {
  return listModelsByKind(kind)
    .map((m) => `${m.id} — ${m.description}`)
    .join(' | ');
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

  return {
    name,
    description: `Submit a ${kindLabel} generation task to kie.ai. Accepts model + input. Returns task_id + estimated_cost_usd. Models: ${modelListFor(acceptedKinds[0])}`,
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Model id from the kie.ai catalog.',
          enum: modelIds,
        },
        input: {
          type: 'object',
          description: 'Model-specific input. Schema differs per model — see kie.ai docs.',
        },
        callBackUrl: {
          type: 'string',
          format: 'uri',
          description: 'Optional webhook URL; kie.ai POSTs there when ready.',
        },
      },
      required: ['model', 'input'],
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({
          model: z.string().min(1),
          input: z.record(z.unknown()),
          callBackUrl: z.string().url().optional(),
        })
        .parse(args);

      const spec = MODEL_REGISTRY[parsed.model];
      if (!spec) {
        throw new Error(`unknown model: ${parsed.model}`);
      }
      if (!acceptedKinds.includes(spec.kind)) {
        throw new Error(
          `model ${parsed.model} is kind=${spec.kind}, not accepted by ${name} (expects ${acceptedKinds.join('|')})`,
        );
      }
      const validatedInput = spec.inputSchema.parse(parsed.input) as Record<string, unknown>;

      const endpoint = getEndpointFor(spec);
      const { taskId } = await ctx.client.createTask(
        endpoint,
        spec.id,
        validatedInput,
        parsed.callBackUrl,
      );

      return {
        task_id: taskId,
        model: spec.id,
        kind: spec.kind,
        endpoint_family: spec.family,
        estimated_cost_usd: Number(spec.estimateCostUsd(validatedInput).toFixed(4)),
        status_hint: `Call kie_wait or kie_status with task_id="${taskId}" to retrieve the result.`,
      };
    },
  };
}

function buildStatusTool(ctx: ToolCtx): ToolHandler {
  return {
    name: 'kie_status',
    description: 'Get the current status of a kie.ai task by id. Returns state, result URLs (if ready), credits consumed.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', minLength: 1 },
        model: {
          type: 'string',
          description: 'Model id (so we know which endpoint family to query).',
          enum: Object.keys(MODEL_REGISTRY),
        },
      },
      required: ['task_id', 'model'],
      additionalProperties: false,
    },
    async handle(args) {
      const parsed = z
        .object({
          task_id: z.string().min(1),
          model: z.string().min(1),
        })
        .parse(args);

      const spec = MODEL_REGISTRY[parsed.model];
      if (!spec) {
        throw new Error(`unknown model: ${parsed.model}`);
      }
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

function buildModelsTool(): ToolHandler {
  return {
    name: 'kie_models',
    description: 'List all registered kie.ai models with kind, endpoint family, and indicative cost.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['image', 'video', 'music', 'speech', 'sfx'],
          description: 'Optional filter by media kind.',
        },
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

export function buildKieTools(ctx: ToolCtx): ToolHandler[] {
  return [
    buildSubmitTool('kie_image', 'image', ['image'], ctx),
    buildSubmitTool('kie_video', 'video', ['video'], ctx),
    buildSubmitTool('kie_music', 'music', ['music'], ctx),
    buildSubmitTool('kie_speech', 'speech/sfx', ['speech', 'sfx'], ctx),
    buildStatusTool(ctx),
    buildModelsTool(),
  ];
}
