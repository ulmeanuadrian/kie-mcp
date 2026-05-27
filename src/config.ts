import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  apiKey: string;
  apiBase: string;
  timeoutMs: number;
  outputDir: string;
  dbPath: string;
  pollIntervalMs: number;
  pollMaxMs: number;
  costBudgetUsd: number | null;
}

const DEFAULTS = {
  apiBase: 'https://api.kie.ai/api/v1',
  timeoutMs: 120_000,
  pollIntervalMs: 3_000,
  pollMaxMs: 600_000,
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const apiKey = env.KIE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      '[kie-mcp] KIE_API_KEY is required. Set it in MCP client env or .env',
    );
  }

  const home = homedir();
  const outputDir = env.KIE_OUTPUT_DIR?.trim() || join(home, '.kie-mcp', 'assets');
  const dbPath = env.KIE_DB_PATH?.trim() || join(home, '.kie-mcp', 'state.db');

  const budget = env.KIE_COST_BUDGET_USD?.trim();
  const costBudgetUsd = budget ? Number(budget) : null;
  if (budget && Number.isNaN(costBudgetUsd)) {
    throw new Error(`[kie-mcp] KIE_COST_BUDGET_USD must be a number, got: ${budget}`);
  }

  return {
    apiKey,
    apiBase: env.KIE_API_BASE?.trim() || DEFAULTS.apiBase,
    timeoutMs: parseIntOr(env.KIE_TIMEOUT_MS, DEFAULTS.timeoutMs),
    outputDir,
    dbPath,
    pollIntervalMs: parseIntOr(env.KIE_POLL_INTERVAL_MS, DEFAULTS.pollIntervalMs),
    pollMaxMs: parseIntOr(env.KIE_POLL_MAX_MS, DEFAULTS.pollMaxMs),
    costBudgetUsd,
  };
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`[kie-mcp] invalid integer: ${raw}`);
  }
  return n;
}
