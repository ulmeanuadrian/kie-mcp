# @ulmeanuadrian/kie-mcp

MCP server for [kie.ai](https://kie.ai) — an aggregator for generative media models (Veo, Suno, Runway, Flux, Nano Banana, Midjourney, ElevenLabs, etc.) with prices well below the official APIs.

**What sets this server apart:**

1. **Sync-wait built-in.** `kie_video(...)` polls the task to completion and downloads the asset locally. No manual polling loop.
2. **Auto-download.** Every successful task writes the file to a predictable local path; the tool returns the absolute path, not a URL that expires.
3. **Five umbrella tools.** `kie_image`, `kie_video`, `kie_music`, `kie_speech`, `kie_compare` — dispatch by `model` param. Not 24 separate tools bloating your MCP context.
4. **Cost telemetry.** `kie_cost_report` shows session + per-model + total spend. Optional `KIE_COST_BUDGET_USD` blocks calls past the cap.
5. **Batch & compare.** `kie_compare(prompt, models=[...])` runs the same prompt on N models in parallel and returns a grid of results.

## Install

```bash
npm install -g @ulmeanuadrian/kie-mcp
```

Or run via `npx` from your MCP client config:

```json
{
  "mcpServers": {
    "kie": {
      "command": "npx",
      "args": ["-y", "@ulmeanuadrian/kie-mcp"],
      "env": {
        "KIE_API_KEY": "sk-..."
      }
    }
  }
}
```

Detailed step-by-step install instructions for Claude Desktop, Claude Code, Cursor, and Windsurf are in [INSTALL.md](./INSTALL.md).

## Tools (12 total)

| Tool | Purpose |
|---|---|
| `kie_image` | Generate / edit an image. Defaults to `wait:true, download:true`. |
| `kie_video` | Generate a video. Defaults to `wait:true, download:true`. |
| `kie_music` | Generate music (Suno). |
| `kie_speech` | TTS and sound effects (ElevenLabs). |
| `kie_compare` | Run the same prompt across N models in parallel (cap 4). Same-kind only. |
| `kie_upload` | Upload a local file (or base64) and get a public URL for `image_input`/reference fields. Generation tools reject local paths, `file://` and `data:` URIs — upload first. Passes through an already-public http(s) url. |
| `kie_wait` | Wait for an existing task_id until it terminates and download. |
| `kie_status` | Get current state of a task without polling. |
| `kie_assets` | List tasks from the local DB filtered by `model` / `state`. |
| `kie_cost_report` | Cumulative cost (all-time or hours window) + budget remaining. |
| `kie_models` | List registered models (id, kind, family, description). |
| `kie_health` | Health probe + echoed config (api_key set / output dir / db path). |

## Registered models (verification status)

| Model | Kind | Endpoint family | Verified live |
|---|---|---|---|
| `nano-banana-2` | image | unified | ✅ 2026-05-27 (live smoke) |
| `flux-kontext-pro` | image | unified | docs only |
| `flux-kontext-max` | image | unified | docs only |
| `gpt-image-2` | image | gpt4o legacy | docs only |
| `seedream-v5-lite` | image | unified | docs only |
| `qwen-image` | image | unified | ⚠️ this ID was not accepted on the API (May 2026); check the current kie.ai catalog |
| `veo3`, `veo3_fast` | video | veo legacy | docs only |
| `runway-aleph` | video | runway legacy | docs only |
| `seedance-2` | video | unified | docs only |
| `suno-v5`, `suno-v4-5` | music | suno legacy | docs only |
| `elevenlabs-tts`, `elevenlabs-sfx` | speech | unified | docs only |

When an ID returns `422: model name not supported`, query `kie_models` to see the registered catalog and update `src/registry.ts` with the exact name from kie.ai's market.

## Configuration

| Env var | Default | Role |
|---|---|---|
| `KIE_API_KEY` | — | Required. Your kie.ai key |
| `KIE_API_BASE` | `https://api.kie.ai/api/v1` | Override base URL |
| `KIE_TIMEOUT_MS` | `120000` | HTTP request timeout |
| `KIE_OUTPUT_DIR` | `$HOME/.kie-mcp/assets` | Where downloaded assets are written |
| `KIE_DB_PATH` | `$HOME/.kie-mcp/state.db` | SQLite path for task tracking + cost |
| `KIE_POLL_INTERVAL_MS` | `3000` | Polling cadence |
| `KIE_POLL_MAX_MS` | `600000` | Polling cap (10 min) |
| `KIE_COST_BUDGET_USD` | — | When set, blocks calls after exceeding the cap |

## Development

```bash
npm install
npm run build
npm run typecheck
npm run eval       # 47 evals across 5 phases (mocked) — should be 47/47 green
npm run eval:live  # adds 2 live calls to kie.ai (needs KIE_API_KEY, costs ~$0.04)
```

## Eval phases

| Phase | Eval file | Tests | Verifies |
|---|---|---|---|
| 0 | `phase0_scaffold.eval.ts` | 6 | Server boot, config validation, MCP round-trip |
| 1 | `phase1_client.eval.ts` | 11 | KieClient serialize / retry / parse across all 5 endpoint families |
| 2 | `phase2_tools.eval.ts` | 12 | Tool discovery, dispatch routing, cross-kind guard, Zod validation |
| 3 | `phase3_wait_download.eval.ts` | 12 | Poller, downloader, store round-trip, idempotency, budget enforcement |
| 4 | `phase4_telemetry_compare.eval.ts` | 5 | kie_compare parallel + graceful degrade, cost report aggregation |
| 5 | `phase5_live_smoke.eval.ts` | 2 (gated) | Real kie.ai call → asset downloaded + cost logged |

**Evals are the source of truth for the contract — any code change must keep 47/47 mocked evals green (or update the evals with an explicit reason in the commit message).**

## Architecture

```
MCP client
   ↓ stdio
src/index.ts ── boot, wire dependencies
src/server.ts ── MCP request routing (tools/list, tools/call)
src/tools.ts ── 12 tool handlers (umbrella + utility + telemetry)
   ↓
src/registry.ts ── MODEL_REGISTRY (id → endpoint family + Zod schema + cost estimator)
   ↓
src/client.ts ── KieClient (fetch + retry + timeout + idempotency-key)
src/endpoints.ts ── 5 endpoint families (unified, veo, runway, suno, gpt4o)
   ↓
src/poller.ts ── pollUntilTerminal (waiting → success/fail)
src/downloader.ts ── AssetDownloader (URL → KIE_OUTPUT_DIR/<task_id>.<ext>)
src/store.ts ── TaskStore (node:sqlite — tasks + idempotency + cost)
```

## License

MIT. See [LICENSE](./LICENSE).
