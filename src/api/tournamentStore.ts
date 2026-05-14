import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.TOURNAMENT_DB_PATH ?? path.join(process.cwd(), 'data', 'tournament.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

const get = db.prepare<[string], { value: string }>('SELECT value FROM kv WHERE key = ?');
const upsert = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const del = db.prepare('DELETE FROM kv WHERE key = ?');

export function kvGet(key: string): string | null {
  return get.get(key)?.value ?? null;
}

export function kvSet(key: string, value: string): void {
  upsert.run(key, value);
}

export function kvDelete(key: string): void {
  del.run(key);
}
