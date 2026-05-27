# Agent guidelines — @ulmeanua/kie-mcp

Scope: modern MCP server for kie.ai, written from scratch (zero copy from other implementations), designed around four differentiators:

1. Built-in sync-wait (the tool polls for the task and returns the local asset path)
2. Consolidated schema (5 umbrella tools instead of N per model)
3. Cost telemetry (kie.ai is chosen for its price — make the price visible)
4. Batch compare (one prompt, N models, parallel)

## Code rules

- **Modules:** ES modules, `.js` extensions in TS imports.
- **Strict TS:** `strict: true`, `noUnusedLocals`, `noImplicitReturns`.
- **Validation:** Zod for any payload entering a tool. The schema is the source of truth for types.
- **No `any`:** prefer `unknown` + narrow.
- **Errors:** wrap in `McpError` with the appropriate `ErrorCode` before they leave a handler.
- **Naming:** camelCase for variables/functions, PascalCase for classes/types.
- **HTTP:** a single `KieClient` with `fetch` + exponential retry + timeout. NEVER call `fetch` directly from tool handlers.
- **Asset persistence:** every URL returned by kie.ai is downloaded into `KIE_OUTPUT_DIR` and the tool returns an absolute path.
- **Telemetry:** every generation call logs `(model, credits, ts)` into the `costs` table.
- **Determinism:** append-only SQLite for audit; idempotency key derived from `(model, prompt_hash, params_hash)`.

## Design rules

- **5 umbrella tools.** Adding a NEW model = one entry in `MODEL_REGISTRY`, not a new tool.
- **`model` is always an enum discriminator.** The tool rejects at validation time if the model isn't registered.
- **`wait` is opt-out, not opt-in.** Default `wait: true` because that's the differentiator. Users explicitly request `wait: false` for async.
- **Cost visible after every call.** The tool returns `cost_usd` in the payload.
- **Concurrency cap for `kie_compare`:** 4 parallel max.

## Eval gate

Every closed phase has a list of asserts the eval gate enforces green:

| Phase | Eval | Verifies |
|------|------|----------|
| 0 | `phase0_scaffold.eval.ts` | Server boots, replies `tools/list` with at least the utility tools |
| 1 | `phase1_client.eval.ts` | KieClient serializes request correctly, retries on 5xx, fails explicitly on 4xx |
| 2 | `phase2_tools.eval.ts` | The 5 umbrella tools appear in `tools/list`; dispatcher rejects unknown models |
| 3 | `phase3_wait_download.eval.ts` | Polling terminates, asset lands on disk, idempotency hit returns the same task |
| 4 | `phase4_telemetry_compare.eval.ts` | Cost report aggregates correctly, `kie_compare` runs N in parallel with cap 4 |
| 5 | `phase5_live_smoke.eval.ts` (gated by `KIE_EVAL_LIVE=1`) | Real kie.ai call with key from env, asset downloaded, cost logged |

`npm run eval` runs all mocked evals. `npm run eval:live` adds the real smoke.

## Convention for adding a new model

1. Add an entry in `src/registry.ts` (`MODEL_REGISTRY`) with: id, kind (image/video/...), endpoint, cost_estimator, param schema.
2. Add a fixture in `tests/fixtures/<model>.json` (mocked kie.ai response).
3. Add a line in `evals/phase2_tools.eval.ts` that verifies the dispatch.
4. DO NOT add a new MCP tool; DO NOT add a new method in `KieClient` unless the endpoint is fundamentally different.

## Commit hygiene

- One commit per phase, message `phaseN: <summary>`.
- `npm run typecheck && npm run eval` must be green before commit.
- Live smoke (`eval:live`) is opt-in; run locally before a release.

## Anti-contamination

The code was written without reference to other kie.ai MCP implementations. Endpoints and parameters come from `https://docs.kie.ai` (public API documentation — facts of API, not third-party IP). If you spot any tool description, variable name or structure that resembles an existing project suspiciously, refactor and raise an issue.
