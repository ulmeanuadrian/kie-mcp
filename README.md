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

## Tool-uri

| Tool | Scop |
|---|---|
| `kie_image` | Generare / editare imagine cu model la alegere (nano-banana, flux, seedream, qwen, gpt-image, midjourney, etc.) |
| `kie_video` | Generare video (veo, sora, runway, kling, seedance, hailuo, wan, etc.) cu sync-wait opt-out |
| `kie_music` | Generare muzicala (suno) |
| `kie_speech` | TTS si sound effects (elevenlabs) |
| `kie_compare` | Ruleaza acelasi prompt pe mai multe modele in paralel pentru selectie |
| `kie_wait` | Asteapta un task_id existent pana ready |
| `kie_assets` | List / cleanup pentru asset-urile descarcate local |
| `kie_cost_report` | Cost cumulativ pe sesiune si pe model |

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
npm test          # unit
npm run eval      # eval gate, mocked
npm run eval:live # eval gate, hits real kie.ai API (needs KIE_API_KEY)
```

## License

MIT. Vezi [LICENSE](./LICENSE).
