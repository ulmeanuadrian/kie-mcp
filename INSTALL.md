# Install @ulmeanuadrian/kie-mcp

This MCP server gives you access to **30+ AI models** through [Kie.ai](https://kie.ai) (Veo, Suno, Runway, Flux, Nano Banana, ElevenLabs, Midjourney, etc.) directly inside Claude Desktop / Claude Code / Cursor / Windsurf. Lower cost than the official APIs, automatic polling for video/music tasks, asset downloaded locally.

---

## 1. Prerequisites

You need **Node.js 22.0 or newer**. Check with:

```bash
node --version
```

If older or missing:
- **Windows / Mac:** [nodejs.org](https://nodejs.org) → download LTS
- **Linux:** [nodejs.org/en/download](https://nodejs.org/en/download)
- **macOS via Homebrew:** `brew install node@22`

## 2. Get a Kie.ai API key

1. Go to [kie.ai/api-key](https://kie.ai/api-key)
2. Sign up (free welcome credits)
3. Copy the key — it's a 32-character hex string (lowercase a–f + digits)

Your first test image (nano-banana-2 at 1K) costs about $0.04 — well within the free tier.

## 3. Configure your MCP client

Pick the section matching your client. The config snippet is the same shape everywhere — only the file path differs.

### Claude Desktop

Edit (create if missing):
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Paste (or merge into existing `mcpServers`):

```json
{
  "mcpServers": {
    "kie": {
      "command": "npx",
      "args": ["-y", "@ulmeanuadrian/kie-mcp"],
      "env": {
        "KIE_API_KEY": "paste-your-real-kie-key-here"
      }
    }
  }
}
```

### Claude Code

Open Claude Code → MCP settings → paste the same JSON snippet above.

### Cursor

Edit (create if missing):
- **Mac / Linux:** `~/.cursor/mcp.json`
- **Windows:** `%USERPROFILE%\.cursor\mcp.json`

Same snippet as Claude Desktop.

### Windsurf

Edit: `~/.codeium/windsurf/mcp_config.json`

Same snippet.

> **Important:** put your **real key** in the `env` block — `${KIE_API_KEY}` or any placeholder syntax is NOT interpolated by most MCP clients. The string between the quotes is what kie-mcp will send to Kie.ai.

## 4. Restart your client

Quit fully (not just close the window) and reopen. On next conversation, the `kie_*` tools should be available.

## 5. Quick test

In your MCP client, tell the AI:

> "Use `kie_health` to confirm the server is running."

You should get back a JSON with `package: @ulmeanuadrian/kie-mcp` and `api_key_set: true`.

Then:

> "Generate an image with nano-banana-2: a red apple on a wooden table, photo realistic."

The AI calls `kie_image` with `wait:true` (default), polls for 30–60 seconds, downloads the asset locally, and returns the local file path.

## 6. Optional environment variables

Add any of these inside the `env` block alongside `KIE_API_KEY`:

| Env var | Default | What it does |
|---|---|---|
| `KIE_OUTPUT_DIR` | `$HOME/.kie-mcp/assets` | Where downloaded assets are written |
| `KIE_DB_PATH` | `$HOME/.kie-mcp/state.db` | SQLite for task tracking + cost telemetry |
| `KIE_COST_BUDGET_USD` | not set | If set (e.g. `5.00`), blocks calls past the cap |
| `KIE_POLL_INTERVAL_MS` | `3000` | Polling cadence for video/music |
| `KIE_POLL_MAX_MS` | `600000` | Polling timeout — 10 min default (large videos may need more) |

Example with a $5 hard cap and a custom output folder:

```json
"env": {
  "KIE_API_KEY": "...",
  "KIE_COST_BUDGET_USD": "5.00",
  "KIE_OUTPUT_DIR": "/Users/me/Desktop/kie-output"
}
```

## 7. Available models

Ask `kie_models` in your client to see the live catalog. Currently registered:

| Category | Models |
|---|---|
| **Image** | nano-banana-2 ✅, flux-kontext-pro, flux-kontext-max, gpt-image-2, seedream-v5-lite, qwen-image\* |
| **Video** | veo3, veo3_fast, runway-aleph, seedance-2 |
| **Music** | suno-v5, suno-v4-5 |
| **Speech** | elevenlabs-tts, elevenlabs-sfx |

✅ verified live against the real API. The rest are mapped from Kie.ai docs — if you hit `422: model name not supported`, that ID was renamed by Kie.ai; please [open an issue](https://github.com/ulmeanuadrian/kie-mcp/issues).

\* `qwen-image` was rejected by the API in May 2026 — Kie.ai uses a different ID; open an issue if you know which.

## 8. Cost so far

At any time:

> "Run `kie_cost_report`."

You get total spend + per-model breakdown + remaining budget (if `KIE_COST_BUDGET_USD` is set).

## 9. Compare models side by side

> "Use `kie_compare` with prompt='X' and models=['nano-banana-2','flux-kontext-pro','seedream-v5-lite']."

Runs all three in parallel (max 4 concurrent) and downloads the grid. Useful when picking the right model for a given prompt.

---

## Alternative install path — for robOS users

> **What is robOS?** robOS is an agentic operating system for Claude Code with persistent memory, installable skills, brand context, and multi-client workspaces. If you don't know what robOS is, visit **[robos.vip](https://robos.vip)** to see what it does.

If you're already running robOS, you don't need to paste your API key into the MCP config. Instead, kie-mcp will read it from your existing `.env` vault.

**One-time setup:**

1. Add the key to your robOS `.env`:

   ```
   KIE_API_KEY=your-real-kie-key
   ```

2. Install kie-mcp globally so robOS can call it as a binary:

   ```bash
   npm install -g @ulmeanuadrian/kie-mcp
   ```

3. Add the `kie` entry to your robOS `.mcp.json`:

   ```json
   "kie": {
     "command": "kie-mcp",
     "env": {
       "KIE_API_KEY": "${KIE_API_KEY}"
     }
   }
   ```

4. Restart Claude Code.

The `${KIE_API_KEY}` placeholder is NOT interpolated by Claude Code, but kie-mcp detects the unexpanded placeholder and auto-loads the real value from your `.env` in the current working directory. Your key stays in the gitignored `.env` vault and never appears in `.mcp.json` (which is committed).

The robOS skill `tool-kie-mcp` (RO triggers) routes generation intents to the right `kie_*` MCP tool automatically.

---

## Troubleshooting

**"Cannot find module '@ulmeanuadrian/kie-mcp'"**
→ Your Node version is <22. Update Node.

**"KIE_API_KEY is required"**
→ The key isn't in the MCP config's `env` block. Double-check the JSON — quotes around the value, no trailing comma issues.

**"kie.ai error (code=401): Invalid API key"**
→ The key is wrong, expired, or you accidentally pasted a placeholder string (e.g. `${KIE_API_KEY}` literal). Regenerate at [kie.ai/api-key](https://kie.ai/api-key) and paste the actual hex value.

**"polling timeout after 600000ms"**
→ The video model took >10 min. Increase `KIE_POLL_MAX_MS`, or call with `wait:false` + then `kie_wait` with a larger `timeout_ms`.

**"cost budget exceeded"**
→ The feature is working. Remove `KIE_COST_BUDGET_USD` from your config or raise the cap.

**Tools don't appear after restart**
→ Make sure your client was fully quit (check menu bar / system tray). Some clients keep a background process.

---

## Issues & contributions

Public repo at **[github.com/ulmeanuadrian/kie-mcp](https://github.com/ulmeanuadrian/kie-mcp)**. Issues and PRs welcome. PRs must keep the eval suite green (`npm run eval` → 55/55 mocked + 2 live).
