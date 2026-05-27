import { z } from 'zod';
import {
  GPT4O_ENDPOINT,
  SUNO_ENDPOINT,
  UNIFIED_ENDPOINT,
  VEO_ENDPOINT,
  RUNWAY_ENDPOINT,
} from './endpoints.js';
import { EndpointSpec, MediaKind, ModelSpec } from './types.js';

const CREDIT_USD = 0.005;

const aspectImageZ = z.enum([
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
  'auto',
]);

const aspectVideoZ = z.enum(['16:9', '9:16', '1:1']);

const NanoBananaInputZ = z
  .object({
    prompt: z.string().min(1).max(20_000),
    image_input: z.array(z.string().url()).max(14).optional(),
    aspect_ratio: aspectImageZ.optional().default('auto'),
    resolution: z.enum(['1K', '2K', '4K']).optional().default('1K'),
    output_format: z.enum(['png', 'jpg']).optional().default('jpg'),
  })
  .strict();

const FluxKontextInputZ = z
  .object({
    prompt: z.string().min(1).max(10_000),
    image_input: z.array(z.string().url()).max(8).optional(),
    aspect_ratio: aspectImageZ.optional(),
  })
  .strict();

const GptImage2InputZ = z
  .object({
    prompt: z.string().min(1).max(10_000),
    size: z.enum(['1:1', '3:2', '2:3']).optional().default('1:1'),
    nVariants: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
    filesUrl: z.array(z.string().url()).optional(),
    maskUrl: z.string().url().optional(),
    isEnhance: z.boolean().optional(),
    enableFallback: z.boolean().optional(),
  })
  .strict();

const SeedreamInputZ = z
  .object({
    prompt: z.string().min(1).max(10_000),
    image_input: z.array(z.string().url()).optional(),
    aspect_ratio: aspectImageZ.optional(),
    resolution: z.enum(['1K', '2K', '4K']).optional(),
  })
  .strict();

const QwenInputZ = z
  .object({
    prompt: z.string().min(1).max(10_000),
    image_input: z.array(z.string().url()).optional(),
    aspect_ratio: aspectImageZ.optional(),
  })
  .strict();

const Veo3InputZ = z
  .object({
    prompt: z.string().min(1).max(5_000),
    aspect_ratio: aspectVideoZ.optional().default('16:9'),
    imageUrls: z.array(z.string().url()).optional(),
    model: z.enum(['veo3', 'veo3_fast']).optional(),
  })
  .strict();

const RunwayInputZ = z
  .object({
    prompt: z.string().min(1).max(2_000),
    duration: z.union([z.literal(5), z.literal(10)]).optional().default(5),
    quality: z.enum(['720p', '1080p']).optional().default('720p'),
    aspectRatio: aspectVideoZ.optional().default('16:9'),
    imageUrl: z.string().url().optional(),
  })
  .strict();

const SeedanceInputZ = z
  .object({
    prompt: z.string().min(1).max(5_000),
    image_input: z.array(z.string().url()).optional(),
    aspect_ratio: aspectVideoZ.optional(),
    duration: z.number().int().min(3).max(12).optional(),
  })
  .strict();

const SunoInputZ = z
  .object({
    prompt: z.string().min(1).max(2_500),
    customMode: z.boolean().optional().default(false),
    instrumental: z.boolean().optional().default(false),
    model: z.enum(['V3_5', 'V4', 'V4_5', 'V5']).optional().default('V4_5'),
    style: z.string().optional(),
    title: z.string().optional(),
  })
  .strict();

const ElevenLabsTtsInputZ = z
  .object({
    text: z.string().min(1).max(5_000),
    voice_id: z.string().min(1),
    model_id: z.string().optional(),
    stability: z.number().min(0).max(1).optional(),
    similarity_boost: z.number().min(0).max(1).optional(),
  })
  .strict();

const ElevenLabsSfxInputZ = z
  .object({
    text: z.string().min(1).max(450),
    duration_seconds: z.number().min(0.5).max(22).optional(),
    prompt_influence: z.number().min(0).max(1).optional(),
  })
  .strict();

function flatRateCost(usd: number): () => number {
  return () => usd;
}

function resolutionCost(input: Record<string, unknown>): number {
  const res = String(input.resolution ?? '1K');
  if (res === '4K') return 18 * CREDIT_USD;
  if (res === '2K') return 12 * CREDIT_USD;
  return 8 * CREDIT_USD;
}

export const MODEL_REGISTRY: Record<string, ModelSpec> = {
  'nano-banana-2': {
    id: 'nano-banana-2',
    kind: 'image',
    family: 'unified',
    description: 'Google Gemini 3 Flash Image (Nano Banana 2). Up to 14 reference images, 4K.',
    inputSchema: NanoBananaInputZ,
    estimateCostUsd: resolutionCost,
  },
  'flux-kontext-pro': {
    id: 'flux-kontext-pro',
    kind: 'image',
    family: 'unified',
    description: 'Black Forest Labs Flux Kontext Pro — context-aware generation + editing.',
    inputSchema: FluxKontextInputZ,
    estimateCostUsd: flatRateCost(0.05),
  },
  'flux-kontext-max': {
    id: 'flux-kontext-max',
    kind: 'image',
    family: 'unified',
    description: 'Flux Kontext Max — premium tier.',
    inputSchema: FluxKontextInputZ,
    estimateCostUsd: flatRateCost(0.08),
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    kind: 'image',
    family: 'gpt4o',
    description: 'OpenAI GPT Image 2 — generation + editing, up to 16 references.',
    inputSchema: GptImage2InputZ,
    estimateCostUsd: (input) => {
      const n = Number(input.nVariants ?? 1);
      return 0.04 * n;
    },
  },
  'seedream-v5-lite': {
    id: 'seedream-v5-lite',
    kind: 'image',
    family: 'unified',
    description: 'ByteDance Seedream V5 Lite — 4K image generation.',
    inputSchema: SeedreamInputZ,
    estimateCostUsd: resolutionCost,
  },
  'qwen-image': {
    id: 'qwen-image',
    kind: 'image',
    family: 'unified',
    description: 'Alibaba Qwen Image — fast generation + edit.',
    inputSchema: QwenInputZ,
    estimateCostUsd: flatRateCost(0.02),
  },
  veo3: {
    id: 'veo3',
    kind: 'video',
    family: 'veo',
    description: 'Google Veo 3 — cinematic 8s video with native audio.',
    inputSchema: Veo3InputZ,
    estimateCostUsd: flatRateCost(2.0),
  },
  veo3_fast: {
    id: 'veo3_fast',
    kind: 'video',
    family: 'veo',
    description: 'Veo 3 Fast — quicker, lower cost.',
    inputSchema: Veo3InputZ,
    estimateCostUsd: flatRateCost(0.3),
  },
  'runway-aleph': {
    id: 'runway-aleph',
    kind: 'video',
    family: 'runway',
    description: 'Runway Aleph — video editing + transformation.',
    inputSchema: RunwayInputZ,
    estimateCostUsd: (input) => {
      const duration = Number(input.duration ?? 5);
      const quality = String(input.quality ?? '720p');
      const base = quality === '1080p' ? 0.15 : 0.08;
      return base * duration;
    },
  },
  'seedance-2': {
    id: 'seedance-2',
    kind: 'video',
    family: 'unified',
    description: 'ByteDance Seedance 2.0 — multimodal video with native audio.',
    inputSchema: SeedanceInputZ,
    estimateCostUsd: (input) => 0.06 * Number(input.duration ?? 5),
  },
  'suno-v5': {
    id: 'suno-v5',
    kind: 'music',
    family: 'suno',
    description: 'Suno V5 — high-fidelity music with vocals up to 8 min.',
    inputSchema: SunoInputZ,
    estimateCostUsd: flatRateCost(0.1),
  },
  'suno-v4-5': {
    id: 'suno-v4-5',
    kind: 'music',
    family: 'suno',
    description: 'Suno V4.5 — fast music generation.',
    inputSchema: SunoInputZ,
    estimateCostUsd: flatRateCost(0.05),
  },
  'elevenlabs-tts': {
    id: 'elevenlabs-tts',
    kind: 'speech',
    family: 'unified',
    description: 'ElevenLabs studio-grade text-to-speech.',
    inputSchema: ElevenLabsTtsInputZ,
    estimateCostUsd: (input) => {
      const chars = String(input.text ?? '').length;
      return 0.00003 * chars;
    },
  },
  'elevenlabs-sfx': {
    id: 'elevenlabs-sfx',
    kind: 'sfx',
    family: 'unified',
    description: 'ElevenLabs sound-effects generator.',
    inputSchema: ElevenLabsSfxInputZ,
    estimateCostUsd: flatRateCost(0.02),
  },
};

export function listModelsByKind(kind: MediaKind | 'sfx'): ModelSpec[] {
  const k = kind === 'sfx' ? 'speech' : kind;
  return Object.values(MODEL_REGISTRY).filter(
    (m) => m.kind === k || (kind === 'speech' && m.kind === 'sfx'),
  );
}

export function getEndpointFor(model: ModelSpec): EndpointSpec {
  switch (model.family) {
    case 'unified':
      return UNIFIED_ENDPOINT;
    case 'veo':
      return VEO_ENDPOINT;
    case 'runway':
      return RUNWAY_ENDPOINT;
    case 'suno':
      return SUNO_ENDPOINT;
    case 'gpt4o':
      return GPT4O_ENDPOINT;
    case 'elevenlabs':
      return UNIFIED_ENDPOINT;
  }
}
