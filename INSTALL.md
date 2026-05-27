# Instalare @robos/kie-mcp — ghid pas cu pas

Acest MCP server iti da acces la **30+ modele AI** prin Kie.ai (Veo, Suno, Runway, Flux, Nano Banana, ElevenLabs, Midjourney, etc.) direct din Claude Desktop / Claude Code / Cursor / Windsurf. Cost mai mic decat API-urile oficiale, polling automat, asset descarcat local.

---

## 1. Cere o cheie Kie.ai

Mergi la [kie.ai/api-key](https://kie.ai/api-key), creeaza un cont si copiaza cheia. Forma: 32 caractere hex (litere a-f + cifre).

Tip: Kie.ai are credite gratuite de bun-venit. Pentru testul tau initial (nano-banana-2 la 1K) costa ~$0.04 — incape lejer in free tier.

## 2. Verifica Node.js

```bash
node --version
```

Trebuie sa fie **22.0 sau mai recent**. Daca ai mai vechi:
- Windows: [nodejs.org](https://nodejs.org) → download LTS
- macOS: `brew install node@22`
- Linux: [nodejs.org/en/download](https://nodejs.org/en/download)

## 3. Configurare in clientul tau MCP

### Claude Desktop

Editeaza fisierul de config:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Adauga (sau insereaza in `mcpServers`):

```json
{
  "mcpServers": {
    "kie": {
      "command": "npx",
      "args": ["-y", "@robos/kie-mcp"],
      "env": {
        "KIE_API_KEY": "cheia-ta-de-la-kie-aici"
      }
    }
  }
}
```

Restart Claude Desktop. La urmatoarea conversatie ar trebui sa vezi tool-urile `kie_*` disponibile.

### Claude Code

In setarile MCP din Claude Code, adauga acelasi snippet ca mai sus.

### Cursor

Edit `~/.cursor/mcp.json` (Mac/Linux) sau `%USERPROFILE%\.cursor\mcp.json` (Windows):

```json
{
  "mcpServers": {
    "kie": {
      "command": "npx",
      "args": ["-y", "@robos/kie-mcp"],
      "env": {
        "KIE_API_KEY": "cheia-ta-aici"
      }
    }
  }
}
```

Restart Cursor.

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json` cu acelasi snippet.

## 4. Test rapid

In oricare client MCP (dupa restart), spune-i AI-ului:

> "Foloseste kie_health ca sa-mi arati ca MCP-ul ruleaza."

Daca raspunde cu un JSON cu `package: @robos/kie-mcp` si `api_key_set: true`, totul merge.

Apoi:

> "Genereaza o imagine cu nano-banana-2: un mar rosu pe o masa de lemn."

AI-ul va apela `kie_image` cu `wait:true` (default), va astepta ~30-60s, va descarca asset-ul si iti va da calea locala unde il gasesti.

## 5. Optionalele care merita stiute

| Env var | Default | Utilitate |
|---|---|---|
| `KIE_OUTPUT_DIR` | `$HOME/.kie-mcp/assets` | Unde se scriu asset-urile |
| `KIE_COST_BUDGET_USD` | nu setat | Daca setezi (ex `5.00`), MCP-ul blocheaza calls cand depasesti |
| `KIE_POLL_INTERVAL_MS` | `3000` | Pace polling-ului pentru video/music (3s default) |
| `KIE_POLL_MAX_MS` | `600000` | Timeout polling (10 min default — videourile mari pot avea nevoie de mai mult) |

Le adaugi in `env` din config-ul MCP:

```json
"env": {
  "KIE_API_KEY": "...",
  "KIE_COST_BUDGET_USD": "5.00",
  "KIE_OUTPUT_DIR": "/Users/me/Desktop/kie-output"
}
```

## 6. Cost so far

In orice moment poti intreba AI-ul:

> "Ruleaza kie_cost_report."

Iti spune cat ai cheltuit total + pe model + buget ramas (daca ai setat `KIE_COST_BUDGET_USD`).

## 7. Compare modele

> "Foloseste kie_compare cu prompt='X' si models=['nano-banana-2','flux-kontext-pro','seedream-v5-lite']."

Ruleaza pe toate 3 in paralel si descarca grid. Util cand vrei sa alegi cel mai bun model pentru un anumit prompt.

## 8. Modele disponibile

Intreaba: `kie_models` (sau cu filtru de kind):

| Categorie | Modele inregistrate |
|---|---|
| **Image** | nano-banana-2 ✅, flux-kontext-pro, flux-kontext-max, gpt-image-2, seedream-v5-lite, qwen-image* |
| **Video** | veo3, veo3_fast, runway-aleph, seedance-2 |
| **Music** | suno-v5, suno-v4-5 |
| **Speech** | elevenlabs-tts, elevenlabs-sfx |

✅ = verificat live cu API-ul real. Restul vin din docs.kie.ai — daca primesti `422: model name not supported`, ID-ul curent in catalogul kie.ai e diferit; raporteaza issue.

\* `qwen-image` nu a fost acceptat in mai 2026 — kie.ai foloseste alt ID; deschide un issue daca ai timp si stii care e numele real.

## 9. Probleme frecvente

**"Cannot find module '@robos/kie-mcp'"**
→ Versiunea ta de Node e <22. Update Node.

**"KIE_API_KEY is required"**
→ Cheia nu e in `env` din MCP config. Verifica ca ai pus-o.

**"kie.ai error (code=401): Invalid API key"**
→ Cheia e gresita sau a expirat. Regenereaza la kie.ai/api-key.

**"polling timeout after 600000ms"**
→ Modelul video ti-a luat >10 min. Mareste `KIE_POLL_MAX_MS` sau foloseste `wait:false` + `kie_wait` cu `timeout_ms` mai mare.

**"cost budget exceeded"**
→ Featura merge. Sterge `KIE_COST_BUDGET_USD` din config sau mareste plafonul.

## 10. Issues / contributii

Repo public la **https://github.com/ulmeanuadrian/kie-mcp**. Issues bine-venite. Commit-uri si PR-uri cu eval-uri verzi (47/47 mocked + 2 live).
