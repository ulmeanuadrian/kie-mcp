# Changelog

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
