import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema";

type Db = Database.Database;

const globalForDb = globalThis as unknown as { __hlPickDb?: Db };

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getDb(): Db {
  if (globalForDb.__hlPickDb) return globalForDb.__hlPickDb;
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "hl.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  globalForDb.__hlPickDb = db;
  return db;
}

export function getState(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM sync_state WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setState(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO sync_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function startSyncRun(job: string): number {
  const info = getDb()
    .prepare(
      "INSERT INTO sync_runs(job, started_at, status) VALUES(?, ?, 'running')",
    )
    .run(job, Date.now());
  return Number(info.lastInsertRowid);
}

export function finishSyncRun(
  id: number,
  status: "ok" | "error" | "skipped",
  meta: unknown,
): void {
  getDb()
    .prepare(
      "UPDATE sync_runs SET finished_at = ?, status = ?, meta_json = ? WHERE id = ?",
    )
    .run(Date.now(), status, JSON.stringify(meta ?? {}), id);
}

export function lastSyncRun(job: string): {
  status: string;
  finishedAt: number | null;
  meta: unknown;
} | null {
  const row = getDb()
    .prepare(
      "SELECT status, finished_at, meta_json FROM sync_runs WHERE job = ? ORDER BY id DESC LIMIT 1",
    )
    .get(job) as
    | { status: string; finished_at: number | null; meta_json: string | null }
    | undefined;
  if (!row) return null;
  let meta: unknown = null;
  try {
    meta = row.meta_json ? JSON.parse(row.meta_json) : null;
  } catch {
    meta = null;
  }
  return { status: row.status, finishedAt: row.finished_at, meta };
}
