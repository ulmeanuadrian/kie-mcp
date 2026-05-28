import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Parses a .env-style file into key/value pairs.
 * Tolerant of:
 *   - blank lines and comments (#)
 *   - quoted values ("..." or '...')
 *   - lines that aren't KEY=VALUE (skipped silently — robOS .env has shell snippets)
 * Does NOT support multi-line values or shell interpolation.
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eqIdx + 1).trim();
    // strip wrapping quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Detects whether a value looks like an unexpanded placeholder ${VAR}.
 * If so, returns true so the caller knows to overwrite it from a .env file.
 */
function looksLikePlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return /^\$\{[A-Z_]+\}$/.test(value.trim());
}

/**
 * Loads .env files into process.env without overriding real values.
 *
 * Search order (first match per variable wins, but a real process.env value
 * always wins over a .env file value UNLESS the process.env value looks
 * like an unexpanded placeholder `${VAR}` — in that case the .env file
 * value is used. This works around MCP clients that don't interpolate
 * env placeholders from their config.
 *
 * Paths tried:
 *   1. cwd/.env             — for project-local configs (robOS, etc.)
 *   2. ~/.kie-mcp/.env      — for user-level fallback (any MCP client)
 */
export function loadDotenvFallback(env: NodeJS.ProcessEnv = process.env): void {
  const candidatePaths = [
    join(process.cwd(), '.env'),
    join(homedir(), '.kie-mcp', '.env'),
  ];

  for (const path of candidatePaths) {
    if (!existsSync(path)) continue;
    let parsed: Record<string, string>;
    try {
      const raw = readFileSync(path, 'utf8');
      parsed = parseEnvFile(raw);
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parsed)) {
      const current = env[key];
      if (current === undefined || current === '' || looksLikePlaceholder(current)) {
        env[key] = value;
      }
    }
  }
}
