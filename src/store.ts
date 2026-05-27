import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface TaskRow {
  task_id: string;
  model: string;
  family: string;
  state: string;
  created_at: number;
  updated_at: number;
  result_urls: string;
  asset_paths: string;
  credits_consumed: number | null;
  cost_usd: number | null;
  error_code: string | null;
  error_message: string | null;
  idempotency_key: string | null;
}

export class TaskStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        family TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        result_urls TEXT NOT NULL DEFAULT '[]',
        asset_paths TEXT NOT NULL DEFAULT '[]',
        credits_consumed REAL,
        cost_usd REAL,
        error_code TEXT,
        error_message TEXT,
        idempotency_key TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
      CREATE INDEX IF NOT EXISTS idx_tasks_idempotency ON tasks(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
    `);
  }

  insert(row: Omit<TaskRow, 'created_at' | 'updated_at'>): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO tasks (
          task_id, model, family, state, created_at, updated_at,
          result_urls, asset_paths, credits_consumed, cost_usd,
          error_code, error_message, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.task_id,
        row.model,
        row.family,
        row.state,
        now,
        now,
        row.result_urls,
        row.asset_paths,
        row.credits_consumed,
        row.cost_usd,
        row.error_code,
        row.error_message,
        row.idempotency_key,
      );
  }

  update(taskId: string, fields: Partial<Omit<TaskRow, 'task_id' | 'created_at'>>): void {
    const keys = Object.keys(fields) as Array<keyof typeof fields>;
    if (!keys.length) return;
    const setClause = keys.map((k) => `${k} = ?`).join(', ') + ', updated_at = ?';
    const values = keys.map((k) => fields[k] ?? null);
    values.push(Date.now());
    values.push(taskId);
    this.db.prepare(`UPDATE tasks SET ${setClause} WHERE task_id = ?`).run(...(values as never[]));
  }

  get(taskId: string): TaskRow | null {
    return (
      (this.db.prepare(`SELECT * FROM tasks WHERE task_id = ?`).get(taskId) as TaskRow | undefined) ??
      null
    );
  }

  findByIdempotencyKey(key: string): TaskRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM tasks WHERE idempotency_key = ? ORDER BY created_at DESC LIMIT 1`)
        .get(key) as TaskRow | undefined) ?? null
    );
  }

  list(opts: { state?: string; limit?: number } = {}): TaskRow[] {
    const limit = opts.limit ?? 50;
    if (opts.state) {
      return this.db
        .prepare(`SELECT * FROM tasks WHERE state = ? ORDER BY created_at DESC LIMIT ?`)
        .all(opts.state, limit) as unknown as TaskRow[];
    }
    return this.db
      .prepare(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as unknown as TaskRow[];
  }

  totalCostUsd(sinceMs?: number): number {
    if (sinceMs) {
      const row = this.db
        .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM tasks WHERE updated_at >= ?`)
        .get(sinceMs) as { total: number };
      return row.total;
    }
    const row = this.db
      .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM tasks`)
      .get() as { total: number };
    return row.total;
  }

  costByModel(sinceMs?: number): Array<{ model: string; count: number; total_usd: number }> {
    const sql = sinceMs
      ? `SELECT model, COUNT(*) AS count, COALESCE(SUM(cost_usd), 0) AS total_usd
         FROM tasks WHERE updated_at >= ? GROUP BY model ORDER BY total_usd DESC`
      : `SELECT model, COUNT(*) AS count, COALESCE(SUM(cost_usd), 0) AS total_usd
         FROM tasks GROUP BY model ORDER BY total_usd DESC`;
    const stmt = this.db.prepare(sql);
    const rows = sinceMs ? stmt.all(sinceMs) : stmt.all();
    return rows as Array<{ model: string; count: number; total_usd: number }>;
  }

  close(): void {
    this.db.close();
  }
}

export function hashIdempotency(model: string, input: Record<string, unknown>): string {
  // deterministic JSON: sort keys
  const sorted = JSON.stringify(input, Object.keys(input).sort());
  // simple FNV-1a 32-bit hash (good enough for cache key, not security)
  let h = 0x811c9dc5;
  const s = `${model}|${sorted}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${model}:${h.toString(16).padStart(8, '0')}`;
}
