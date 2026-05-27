# @robos/kie-mcp

MCP server pentru [kie.ai](https://kie.ai) — un agregator de modele generative (Veo, Suno, Runway, Flux, Nano Banana, Midjourney, ElevenLabs, etc.) cu preturi mai mici decat API-urile oficiale.

**Diferentiatori fata de alte MCP-uri kie.ai:**

1. **Sync-wait built-in.** `kie_video(...)` asteapta task-ul si descarca asset-ul. Fara polling manual.
2. **Auto-download.** Fiecare task ready scrie fisierul local intr-un path predictabil; tool-ul returneaza calea absoluta, nu URL care expira.
3. **Cinci tool-uri umbrela.** `kie_image`, `kie_video`, `kie_music`, `kie_speech`, `kie_compare` — dispatcher pe `model`. Nu 24 de tool-uri care umfla context-ul MCP.
4. **Cost telemetry.** `kie_cost_report` arata cat ai cheltuit pe sesiune, model si total. Optional `KIE_COST_BUDGET_USD` opreste apelurile peste plafon.
5. **Batch & compare.** `kie_compare(prompt, models=[...])` ruleaza paralel pe N modele si returneaza un grid de rezultate.

## Install

```bash
npm install -g @robos/kie-mcp
```

Sau ruleaza prin `npx`:

```json
{
  "mcpServers": {
    "kie": {
      "command": "npx",
      "args": ["-y", "@robos/kie-mcp"],
      "env": {
        "KIE_API_KEY": "sk-..."
      }
    }
  }
}
```

## Tool-uri (10 total)

| Tool | Scop |
|---|---|
| `kie_image` | Generare / editare imagine. Default `wait:true, download:true`. |
| `kie_video` | Generare video. Default `wait:true, download:true`. |
| `kie_music` | Generare muzicala (suno). |
| `kie_speech` | TTS si sound effects (elevenlabs). |
| `kie_compare` | Ruleaza acelasi prompt pe N modele paralel (cap 4). Same-kind only. |
| `kie_wait` | Asteapta un task_id existent pana ready si descarca. |
| `kie_status` | Stare instant a unui task fara polling. |
| `kie_assets` | Lista task-uri din DB local cu filtre `model`/`state`. |
| `kie_cost_report` | Cost cumulativ all-time sau pe window de ore + buget remaining. |
| `kie_models` | Catalogul modelelor inregistrate (id, kind, family, descriere). |
| `kie_health` | Probe de health + config echoed. |

## Modele inregistrate (status verificare)

| Model | Kind | Endpoint family | Verificat live |
|---|---|---|---|
| `nano-banana-2` | image | unified | ✅ 2026-05-27 (smoke real) |
| `flux-kontext-pro` | image | unified | docs only |
| `flux-kontext-max` | image | unified | docs only |
| `gpt-image-2` | image | gpt4o legacy | docs only |
| `seedream-v5-lite` | image | unified | docs only |
| `qwen-image` | image | unified | ⚠️ ID-ul nu a fost acceptat pe API (mai 2026); verifica catalogul kie.ai |
| `veo3`, `veo3_fast` | video | veo legacy | docs only |
| `runway-aleph` | video | runway legacy | docs only |
| `seedance-2` | video | unified | docs only |
| `suno-v5`, `suno-v4-5` | music | suno legacy | docs only |
| `elevenlabs-tts`, `elevenlabs-sfx` | speech | unified | docs only |

Cand un ID intoarce `422: model name not supported`, foloseste `kie_models` ca sa vezi catalogul curent si actualizeaza `src/registry.ts` cu numele exact din kie.ai.

## Configuration

| Env var | Implicit | Rol |
|---|---|---|
| `KIE_API_KEY` | — | Obligatoriu. Cheia ta de la kie.ai |
| `KIE_API_BASE` | `https://api.kie.ai/api/v1` | Override base URL |
| `KIE_TIMEOUT_MS` | `120000` | Timeout pe request HTTP |
| `KIE_OUTPUT_DIR` | `$HOME/.kie-mcp/assets` | Unde se scriu asset-urile descarcate |
| `KIE_DB_PATH` | `$HOME/.kie-mcp/state.db` | SQLite pentru task tracking + cost |
| `KIE_POLL_INTERVAL_MS` | `3000` | Cat de des polleaza pentru task status |
| `KIE_POLL_MAX_MS` | `600000` | Polling cap (10 min) |
| `KIE_COST_BUDGET_USD` | — | Daca e setat, opreste apeluri cand depasesti |

## Architecture

```
MCP client → src/index.ts (tool routing)
           → src/tools/*.ts (5 umbrella tools + utility)
           → src/client.ts (KieClient — fetch + retry + polling)
           → src/store.ts (SQLite — tasks, costs, idempotency)
           → src/downloader.ts (asset persistence)
```

## Development

```bash
npm install
npm run build
npm run typecheck
npm run eval       # 47 evals across 5 phases (mocked) — should be 47/47 green
npm run eval:live  # adds 2 live calls to kie.ai (needs KIE_API_KEY, costs ~$0.04)
```

## Eval phases

| Phase | Eval file | Tests | Verifica |
|---|---|---|---|
| 0 | `phase0_scaffold.eval.ts` | 6 | Server boot, config validation, MCP round-trip |
| 1 | `phase1_client.eval.ts` | 11 | KieClient serialize/retry/parse pentru toate 5 familii |
| 2 | `phase2_tools.eval.ts` | 12 | Tool discovery, dispatch routing, cross-kind guard, Zod validation |
| 3 | `phase3_wait_download.eval.ts` | 12 | Poller, downloader, store round-trip, idempotency, budget enforcement |
| 4 | `phase4_telemetry_compare.eval.ts` | 5 | kie_compare paralel + graceful degrade, cost report aggregation |
| 5 | `phase5_live_smoke.eval.ts` | 2 (gated) | Apel real kie.ai → asset descarcat + cost logged |

**Eval-urile sunt sursa de adevar pentru contract — orice change la cod trebuie sa pastreze 47/47 green (sau sa actualizeze eval-urile cu motiv explicit in commit message).**

## Architecture

```
MCP client
   ↓ stdio
src/index.ts ── boot, wire dependencies
src/server.ts ── MCP request routing (tools/list, tools/call)
src/tools.ts ── 10 tool handlers (umbrella + utility + telemetry)
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

MIT. Vezi [LICENSE](./LICENSE).
