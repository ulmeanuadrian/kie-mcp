import { readFileSync } from 'node:fs';
import { MODEL_REGISTRY, getEndpointFor } from '../src/registry.js';
import { resolveApiModel } from '../src/types.js';
import { PKG_VERSION } from '../src/version.js';

/**
 * Model names kie.ai accepted on POST /jobs/createTask, probed on 2026-09-09.
 *
 * The probe distinguishes an unknown model from a valid one by the error the
 * API returns: an unknown name answers "The model name you specified is not
 * supported", while a known name answers with an input-validation error such
 * as "prompt is required". Re-probe with that method before editing this list.
 */
const CONFIRMED_API_MODELS = new Set([
  'nano-banana-2',
  'flux-kontext-pro',
  'flux-kontext-max',
  'seedream/5-lite-text-to-image',
  'seedream/5-lite-image-to-image',
  'qwen/text-to-image',
  'qwen/image-edit',
  'bytedance/seedance-2',
  'elevenlabs/text-to-speech-multilingual-v2',
]);

/** Names kie.ai rejected on the same probe. Kept so a regression names itself. */
const REJECTED_API_MODELS = new Set([
  'seedream-v5-lite',
  'qwen-image',
  'seedance-2',
  'elevenlabs-tts',
  'elevenlabs-sfx',
]);

const unifiedSpecs = Object.values(MODEL_REGISTRY).filter((m) => m.family === 'unified');

describe('Phase 7 — kie.ai model names on the wire', () => {
  test('registry still has unified-family models to check', () => {
    expect(unifiedSpecs.length).toBeGreaterThan(0);
  });

  test.each(unifiedSpecs.map((s) => [s.id, s] as const))(
    'every name %s sends to kie is one the API accepts',
    (_id, spec) => {
      // Both branches: no reference image, and one supplied.
      const withoutImage = resolveApiModel(spec, { prompt: 'x' });
      const withImage = resolveApiModel(spec, {
        prompt: 'x',
        image_input: ['https://example.com/a.png'],
      });

      for (const name of [withoutImage, withImage]) {
        expect(REJECTED_API_MODELS.has(name)).toBe(false);
        expect(CONFIRMED_API_MODELS.has(name)).toBe(true);
      }
    },
  );

  test('a model split by task picks the variant matching the input', () => {
    const seedream = MODEL_REGISTRY['seedream-v5-lite'];
    expect(resolveApiModel(seedream, { prompt: 'x' })).toBe('seedream/5-lite-text-to-image');
    expect(
      resolveApiModel(seedream, { prompt: 'x', image_input: ['https://example.com/a.png'] }),
    ).toBe('seedream/5-lite-image-to-image');

    const qwen = MODEL_REGISTRY['qwen-image'];
    expect(resolveApiModel(qwen, { prompt: 'x' })).toBe('qwen/text-to-image');
    expect(resolveApiModel(qwen, { prompt: 'x', image_input: ['https://example.com/a.png'] })).toBe(
      'qwen/image-edit',
    );

    // An empty array is not a reference image.
    expect(resolveApiModel(qwen, { prompt: 'x', image_input: [] })).toBe('qwen/text-to-image');
  });

  test('a spec without apiModel falls back to its exposed id', () => {
    const nano = MODEL_REGISTRY['nano-banana-2'];
    expect(nano.apiModel).toBeUndefined();
    expect(resolveApiModel(nano, { prompt: 'x' })).toBe('nano-banana-2');
  });

  test('the unified endpoint is the only family that sends a model name', () => {
    for (const spec of Object.values(MODEL_REGISTRY)) {
      if (spec.family === 'unified') continue;
      // Dedicated endpoints ignore the model argument, so an apiModel there
      // would be silently dead configuration.
      expect(spec.apiModel).toBeUndefined();
    }
  });

  test('the unified endpoint puts the resolved name in the request body', () => {
    const spec = MODEL_REGISTRY['seedance-2'];
    const endpoint = getEndpointFor(spec);
    const body = endpoint.buildCreateBody(resolveApiModel(spec, { prompt: 'x' }), {
      prompt: 'x',
    }) as Record<string, unknown>;
    expect(body.model).toBe('bytedance/seedance-2');
  });

  test('PKG_VERSION matches package.json', () => {
    // kie_health reports PKG_VERSION, and the robOS skill reads it to decide
    // whether the installed bridge already carries the apiModel mapping. A
    // stale constant makes that check lie, so pin the two together.
    // jest runs from the project root, where package.json lives.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(PKG_VERSION).toBe(pkg.version);
  });

  test('elevenlabs sound effects stays unlisted while kie has no such model', () => {
    // kie.ai only exposes text-to-speech under elevenlabs; the removed
    // elevenlabs-sfx id returned "model name not supported" on every call.
    expect(MODEL_REGISTRY['elevenlabs-sfx']).toBeUndefined();
  });
});
