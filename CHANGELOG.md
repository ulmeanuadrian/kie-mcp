# Changelog

## 0.4.0

### Fixed

**Breaking:** the model registered as `runway-aleph` was never Aleph. It posted
to `/runway/generate` with the Gen-4 input schema (`prompt`, `duration`,
`quality`, `aspectRatio`, `imageUrl`), which is Runway Gen-4 Turbo
text-to-video and image-to-video. It is now registered as `runway-gen4-turbo`
with that description, and its cost estimate follows kie.ai's per-video price
(12 credits at 720p, 30 at 1080p) instead of a per-second guess that was
roughly seven times too high.

Runway Aleph itself is not added: on 2026-10-31 docs.kie.ai marked it
"Discontinued. Runway Aleph is no longer available on Kie AI", and two valid
`runway/gen4-aleph` jobs (public mp4 plus reference image) failed with
`failCode 500 internal error` at zero credits. The name still passes the
empty-input probe, so `check:models` cannot catch this; the registry simply
does not carry it. Upstream, Runway retired Gen-4 Aleph from the Runway Dev
API on 2026-07-30 (api changelog, "Gen-3 Alpha Turbo and Gen-4 Aleph sunset");
its successor Aleph 2.0 is not in the kie.ai catalog.

### Added

Two video-to-video models on the `unified` endpoint, both run as paid jobs
on 2026-10-31 and matched to the credits kie.ai charged:

| Public id | Name sent to kie.ai | Input | Price |
|---|---|---|---|
| `wan-animate-replace` | `wan/2-2-animate-replace` | `video_url`, `image_url`, `resolution` 480p/580p/720p, `nsfw_checker` | 6 / 9.5 / 12.5 credits per second of the clip |
| `kling-motion-control` | `kling-3.0/motion-control` | `prompt`, `input_urls` (one image), `video_urls` (one 3-30 s clip), `mode` 720p/1080p, `character_orientation` | 20 / 27 credits per second of the clip |

A 5 s clip cost 62.5 credits (0.31 USD) on Wan at 720p and 100 credits
(0.50 USD) on Kling at 720p. Wan keeps the clip's background and motion and
puts the character from the image into it; Kling animates the character with
the clip's motion but takes the background from the image.

Both bill per second of the source clip, and the server cannot read a clip's
length from a URL, so `estimated_cost_usd` assumes a 5 s clip
(`ASSUMED_CLIP_SECONDS` in `src/registry.ts`). The `cost_usd` reported after
the task finishes comes from `creditsConsumed` and is exact.

`evals/phase8_video_to_video.eval.ts` pins the three entries: names on the
wire, schemas, the estimates against the credits charged on 2026-10-31, and
the absence of `runway-aleph`.

## 0.3.0

### Fixed

Five of the eight `unified`-family models could never complete a call. The
server sent its own public id as the model name on the wire, but kie.ai had
renamed or namespaced those models, so every request came back with
`422: model name not supported`.

Probed against `POST /jobs/createTask` on 2026-09-09:

| Public id | Was sent | Now sent |
|---|---|---|
| `seedance-2` | `seedance-2` (rejected) | `bytedance/seedance-2` |
| `seedream-v5-lite` | `seedream-v5-lite` (rejected) | `seedream/5-lite-text-to-image`, or `seedream/5-lite-image-to-image` with `image_input` |
| `qwen-image` | `qwen-image` (rejected) | `qwen/text-to-image`, or `qwen/image-edit` with `image_input` |
| `elevenlabs-tts` | `elevenlabs-tts` (rejected) | `elevenlabs/text-to-speech-multilingual-v2` |
| `nano-banana-2`, `flux-kontext-pro`, `flux-kontext-max` | unchanged, already accepted | unchanged |

The `qwen-image` failure was already known and documented in README and
INSTALL as an open question. It is now closed.

### Changed

`ModelSpec` gained an optional `apiModel`, and `resolveApiModel(spec, input)`
resolves it. The public ids this server exposes are now decoupled from the
names kie.ai expects, so a future rename upstream is a one-line mapping change
instead of a breaking change for clients.

`apiModel` also accepts a function of the validated input, because kie.ai
splits some models into separate text-to-X and X-to-X catalog entries while
this server exposes a single id whose `image_input` is optional.

Only the `unified` endpoint sends a model name. The dedicated families (`veo`,
`runway`, `suno`, `gpt4o`) ignore it, and a test now asserts that no spec in
those families carries a dead `apiModel`.

### Removed

**Breaking:** `elevenlabs-sfx` is no longer registered. kie.ai lists elevenlabs
only under Text to Speech, so that id returned `model name not supported` on
every call. `kie_speech` and `kie_models` still accept `kind: 'sfx'`; the
category is simply empty until kie.ai offers such a model.

### Added

`npm run check:models` probes every name the server would send and reports
which ones the API rejects. It creates no paid job: each probe posts an empty
input, so a recognized model answers with an input-validation error and an
unknown one answers `model name not supported`. Run it after editing
`src/registry.ts`.

Fourteen tests in `evals/phase7_api_model_names.eval.ts` pin the mapping,
including both branches of every input-dependent name.

### Fixed (also)

`PKG_VERSION` in `src/version.ts` had drifted to `0.2.0` while package.json
said `0.2.1`, so `kie_health` reported the wrong version. It is now `0.3.0`,
and a test fails the build whenever the constant and package.json disagree.

## 0.2.1

Earlier releases are not covered by this file.
