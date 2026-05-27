# Install @ulmeanuadrian/kie-mcp — step-by-step guide

This MCP server gives you access to **30+ AI models** through Kie.ai (Veo, Suno, Runway, Flux, Nano Banana, ElevenLabs, Midjourney, etc.) directly inside Claude Desktop / Claude Code / Cursor / Windsurf. Lower cost than the official APIs, automatic polling, asset downloaded locally.

---

## 1. Get a Kie.ai API key

Go to [kie.ai/api-key](https://kie.ai/api-key), create an account and copy the key. Format: 32 hex characters (a–f + digits).

Tip: Kie.ai gives free welcome credits. Your first test call (nano-banana-2 at 1K) costs ~$0.04 — well within the free tier.

## 2. Check Node.js

```bash
node --version
```

You need **22.0 or newer**. If older:
- Windows: [nodejs.org](https://nodejs.org) → download LTS
- macOS: `brew install node@22`
- Linux: [nodejs.org/en/download](https://nodejs.org/en/download)

## 3. Configure in your MCP client

### Claude Desktop

Edit the config file:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add (or merge into `mcpServers`):

```json
{
  "mcpServers": {
    "kie": {
      "command": "npx",
      "args": ["-y", "@ulmeanuadrian/kie-mcp"],
      "env": {
        "KIE_API_KEY": "your-kie-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. On your next conversation, the `kie_*` tools should be available.

### Claude Code

In Claude Code's MCP settings, add the same snippet as above.

### Cursor

Edit `~/.cursor/mcp.json` (Mac/Linux) or `%USERPROFILE%\.cursor\mcp.json` (Windows):

```json
{
  "mcpServers": {
    "kie": {
      "command": "npx",
      "args": ["-y", "@ulmeanuadrian/kie-mcp"],
      "env": {
        "KIE_API_KEY": "your-key-here"
      }
    }
  }
}
```

Restart Cursor.

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json` with the same snippet.

## 4. Quick test

In any MCP client (after restart), tell the AI:

> "Use kie_health to show me the server is running."

If it replies with a JSON containing `package: @ulmeanuadrian/kie-mcp` and `api_key_set: true`, you're set.

Then:

> "Generate an image with nano-banana-2: a red apple on a wooden table."

The AI will call `kie_image` with `wait:true` (default), wait ~30–60s, download the asset and give you back the local path.

## 5. Optional environment variables

| Env var | Default | What it does |
|---|---|---|
| `KIE_OUTPUT_DIR` | `$HOME/.kie-mcp/assets` | Where downloaded assets are written |
| `KIE_COST_BUDGET_USD` | not set | If set (e.g. `5.00`), MCP blocks calls past the cap |
| `KIE_POLL_INTERVAL_MS` | `3000` | Polling cadence for video/music (3s default) |
| `KIE_POLL_MAX_MS` | `600000` | Polling timeout (10 min default — large videos may need more) |

Add them in the MCP config's `env` block:

```json
"env": {
  "KIE_API_KEY": "...",
  "KIE_COST_BUDGET_USD": "5.00",
  "KIE_OUTPUT_DIR": "/Users/me/Desktop/kie-output"
}
```

## 6. Cost so far

At any time, ask the AI:

> "Run kie_cost_report."

You get total spend + per-model breakdown + remaining budget (if `KIE_COST_BUDGET_USD` is set).

## 7. Compare models

> "Use kie_compare with prompt='X' and models=['nano-banana-2','flux-kontext-pro','seedream-v5-lite']."

Runs all 3 in parallel and downloads the grid. Useful when picking the best model for a given prompt.

## 8. Available models

Ask: `kie_models` (or filtered by kind):

| Category | Registered models |
|---|---|
| **Image** | nano-banana-2 ✅, flux-kontext-pro, flux-kontext-max, gpt-image-2, seedream-v5-lite, qwen-image* |
| **Video** | veo3, veo3_fast, runway-aleph, seedance-2 |
| **Music** | suno-v5, suno-v4-5 |
| **Speech** | elevenlabs-tts, elevenlabs-sfx |

✅ = verified live against the real API. The rest come from docs.kie.ai — if you get `422: model name not supported`, the current ID in kie.ai's catalog is different; please open an issue.

\* `qwen-image` was not accepted in May 2026 — kie.ai uses a different ID; open an issue if you know the real name.

## 9. Common issues

**"Cannot find module '@ulmeanuadrian/kie-mcp'"**
→ Your Node version is <22. Update Node.

**"KIE_API_KEY is required"**
→ The key isn't in the MCP config's `env`. Double-check.

**"kie.ai error (code=401): Invalid API key"**
→ The key is wrong or expired. Regenerate at kie.ai/api-key.

**"polling timeout after 600000ms"**
→ The video model took >10 min. Increase `KIE_POLL_MAX_MS` or use `wait:false` + `kie_wait` with a larger `timeout_ms`.

**"cost budget exceeded"**
→ The feature is working. Remove `KIE_COST_BUDGET_USD` from config or raise the cap.

## 10. Issues / contributions

Public repo at **https://github.com/ulmeanuadrian/kie-mcp**. Issues welcome. PRs require green evals (47/47 mocked + 2 live).
