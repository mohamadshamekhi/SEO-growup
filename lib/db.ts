// SQLite access layer. One connection for the whole process (Node is single-threaded,
// so the thread-local-connection dance the Python version does is unnecessary here).
// Mirrors hub/db.py's q/one/run/many helpers on purpose: most of the 28 Python modules
// being ported lean on exactly these four shapes, so keeping the same names and
// positional-params convention (prepare().all(...params)) minimizes translation risk.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.HUB_DATA || path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "hub.db");

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000"); // Next's build-time page-data collection runs several
// worker processes in parallel, each importing this module against the same (throwaway,
// build-local) db file — without a timeout, two workers racing to set journal_mode=WAL on
// the same file can hit SQLITE_BUSY immediately instead of just waiting their turn.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function q<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...params);
}

export function many(sql: string, rows: unknown[][]) {
  const stmt = db.prepare(sql);
  const insertMany = db.transaction((rs: unknown[][]) => { for (const r of rs) stmt.run(...r); });
  insertMany(rows);
}

// Generic key-value escape hatch, ported from Python's `settings` table usage
// (hub/db.py get_setting/set_setting) — many "features" live here as JSON blobs
// instead of their own table; port each key's shape as it's encountered, not upfront.
export function now(): number {
  return Date.now() / 1000;
}

/** Matches Python's datetime.date.fromtimestamp(ts).isoformat() — the server's LOCAL
 * calendar date for a unix timestamp, not UTC. Date#toISOString() is UTC and silently
 * shifts the date in timezones ahead of UTC (e.g. right after local midnight) — do not use
 * it for this; found by comparing against Python's actual output. */
export function localDateStr(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function getSetting<T = unknown>(key: string, fallback: T): T {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key=?", key);
  if (!row) return fallback;
  try { return JSON.parse(row.value) as T; } catch { return fallback; }
}

export function setSetting(key: string, value: unknown) {
  run("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(value));
}

export { db, DATA_DIR, DB_PATH };
