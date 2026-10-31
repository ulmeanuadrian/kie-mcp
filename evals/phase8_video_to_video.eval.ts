import { MODEL_REGISTRY, ASSUMED_CLIP_SECONDS, getEndpointFor } from '../src/registry.js';
import { resolveApiModel } from '../src/types.js';

/**
 * Phase 8 pins the 0.4.0 video entries against what kie.ai did on 2026-10-31:
 *
 * - `wan/2-2-animate-replace`, 5 s clip at 720p: success, creditsConsumed 62.5
 * - `kling-3.0/motion-control`, 5 s clip at 720p: success, creditsConsumed 100
 * - `/runway/generate`, 5 s at 720p: success, 12 credits (kie.ai lists 12 per
 *   video at 720p and 30 at 1080p; the model behind it is Gen-4 Turbo)
 * - `runway/gen4-aleph`: two valid jobs failed with `500 internal error` at 0
 *   credits, and docs.kie.ai marks Aleph discontinued
 *
 * One credit is 0.005 USD.
 */
const CREDIT_USD = 0.005;
const VIDEO = 'https://example.com/clip.mp4';
const IMAGE = 'https://example.com/face.jpg';

describe('Phase 8 — video-to-video models and the Runway rename', () => {
  test('runway-aleph is gone and runway-gen4-turbo took its slot', () => {
    expect(MODEL_REGISTRY['runway-aleph']).toBeUndefined();
    const spec = MODEL_REGISTRY['runway-gen4-turbo'];
    expect(spec.kind).toBe('video');
    expect(spec.family).toBe('runway');
    expect(spec.apiModel).toBeUndefined();
    expect(getEndpointFor(spec).createPath).toBe('/runway/generate');
    expect(spec.description).toMatch(/Gen-4 Turbo/);
  });

  test('runway-gen4-turbo bills per video, not per second', () => {
    const spec = MODEL_REGISTRY['runway-gen4-turbo'];
    const at720 = spec.inputSchema.parse({ prompt: 'x', duration: 5, quality: '720p' });
    const at720long = spec.inputSchema.parse({ prompt: 'x', duration: 10, quality: '720p' });
    const at1080 = spec.inputSchema.parse({ prompt: 'x', duration: 5, quality: '1080p' });
    expect(spec.estimateCostUsd(at720)).toBeCloseTo(12 * CREDIT_USD, 6);
    expect(spec.estimateCostUsd(at720long)).toBeCloseTo(12 * CREDIT_USD, 6);
    expect(spec.estimateCostUsd(at1080)).toBeCloseTo(30 * CREDIT_USD, 6);
  });

  test('wan-animate-replace sends the kie.ai name and the input as given', () => {
    const spec = MODEL_REGISTRY['wan-animate-replace'];
    expect(spec.kind).toBe('video');
    expect(spec.family).toBe('unified');
    const input = spec.inputSchema.parse({
      video_url: VIDEO,
      image_url: IMAGE,
      resolution: '720p',
      nsfw_checker: false,
    }) as Record<string, unknown>;
    const name = resolveApiModel(spec, input);
    expect(name).toBe('wan/2-2-animate-replace');
    const body = getEndpointFor(spec).buildCreateBody(name, input) as Record<string, unknown>;
    expect(body.model).toBe('wan/2-2-animate-replace');
    expect(body.input).toEqual({
      video_url: VIDEO,
      image_url: IMAGE,
      resolution: '720p',
      nsfw_checker: false,
    });
  });

  test('wan-animate-replace estimate matches the 62.5 credits charged for 5 s at 720p', () => {
    const spec = MODEL_REGISTRY['wan-animate-replace'];
    expect(ASSUMED_CLIP_SECONDS).toBe(5);
    const at720 = spec.inputSchema.parse({ video_url: VIDEO, image_url: IMAGE, resolution: '720p' });
    expect(spec.estimateCostUsd(at720)).toBeCloseTo(62.5 * CREDIT_USD, 6);
    const at580 = spec.inputSchema.parse({ video_url: VIDEO, image_url: IMAGE, resolution: '580p' });
    expect(spec.estimateCostUsd(at580)).toBeCloseTo(9.5 * 5 * CREDIT_USD, 6);
    // kie.ai defaults to 480p when resolution is omitted.
    const byDefault = spec.inputSchema.parse({ video_url: VIDEO, image_url: IMAGE }) as Record<
      string,
      unknown
    >;
    expect(byDefault.resolution).toBe('480p');
    expect(spec.estimateCostUsd(byDefault)).toBeCloseTo(6 * 5 * CREDIT_USD, 6);
  });

  test('wan-animate-replace requires both files and rejects unknown fields', () => {
    const spec = MODEL_REGISTRY['wan-animate-replace'];
    expect(() => spec.inputSchema.parse({ image_url: IMAGE })).toThrow();
    expect(() => spec.inputSchema.parse({ video_url: VIDEO })).toThrow();
    expect(() => spec.inputSchema.parse({ video_url: 'not a url', image_url: IMAGE })).toThrow();
    expect(() =>
      spec.inputSchema.parse({ video_url: VIDEO, image_url: IMAGE, resolution: '1080p' }),
    ).toThrow();
    expect(() =>
      spec.inputSchema.parse({ video_url: VIDEO, image_url: IMAGE, prompt: 'x' }),
    ).toThrow();
  });

  test('kling-motion-control sends the kie.ai name with one image and one clip', () => {
    const spec = MODEL_REGISTRY['kling-motion-control'];
    expect(spec.kind).toBe('video');
    expect(spec.family).toBe('unified');
    const input = spec.inputSchema.parse({
      prompt: 'dancing',
      input_urls: [IMAGE],
      video_urls: [VIDEO],
    }) as Record<string, unknown>;
    // kie.ai defaults: 720p, orientation from the video.
    expect(input.mode).toBe('720p');
    expect(input.character_orientation).toBe('video');
    const name = resolveApiModel(spec, input);
    expect(name).toBe('kling-3.0/motion-control');
    const body = getEndpointFor(spec).buildCreateBody(name, input) as Record<string, unknown>;
    expect(body.model).toBe('kling-3.0/motion-control');
    expect((body.input as Record<string, unknown>).input_urls).toEqual([IMAGE]);
  });

  test('kling-motion-control estimate matches the 100 credits charged for 5 s at 720p', () => {
    const spec = MODEL_REGISTRY['kling-motion-control'];
    const at720 = spec.inputSchema.parse({ input_urls: [IMAGE], video_urls: [VIDEO] });
    expect(spec.estimateCostUsd(at720)).toBeCloseTo(100 * CREDIT_USD, 6);
    const at1080 = spec.inputSchema.parse({
      input_urls: [IMAGE],
      video_urls: [VIDEO],
      mode: '1080p',
    });
    expect(spec.estimateCostUsd(at1080)).toBeCloseTo(27 * 5 * CREDIT_USD, 6);
  });

  test('kling-motion-control takes exactly one image and one clip', () => {
    const spec = MODEL_REGISTRY['kling-motion-control'];
    expect(() => spec.inputSchema.parse({ input_urls: [IMAGE] })).toThrow();
    expect(() => spec.inputSchema.parse({ video_urls: [VIDEO] })).toThrow();
    expect(() => spec.inputSchema.parse({ input_urls: [], video_urls: [VIDEO] })).toThrow();
    expect(() =>
      spec.inputSchema.parse({ input_urls: [IMAGE, IMAGE], video_urls: [VIDEO] }),
    ).toThrow();
    expect(() =>
      spec.inputSchema.parse({ input_urls: [IMAGE], video_urls: [VIDEO], mode: '480p' }),
    ).toThrow();
    expect(() =>
      spec.inputSchema.parse({
        input_urls: [IMAGE],
        video_urls: [VIDEO],
        character_orientation: 'prompt',
      }),
    ).toThrow();
  });

  test('both new models are listed under kie_video (kind video)', () => {
    const videoIds = Object.values(MODEL_REGISTRY)
      .filter((m) => m.kind === 'video')
      .map((m) => m.id);
    expect(videoIds).toEqual(
      expect.arrayContaining(['runway-gen4-turbo', 'wan-animate-replace', 'kling-motion-control']),
    );
  });
});
