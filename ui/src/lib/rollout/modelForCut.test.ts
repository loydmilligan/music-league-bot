import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { modelForCut } from './modelForCut.js';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
});

function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value);
}

describe('modelForCut (I9 — spec §6: cuts are additional pinnable keys)', () => {
  it('a pinned digest_model_<cutId> wins, translated to a claude CLI name', () => {
    setSetting('digest_model_ledes', 'anthropic/claude-opus-5');
    expect(modelForCut('ledes', db)).toBe('claude-opus-5');
  });

  it('falls through to the digest bucket default', () => {
    setSetting('digest_model', 'anthropic/claude-sonnet-4-5');
    expect(modelForCut('punchup', db)).toBe('claude-sonnet-4-5');
  });

  it('a non-anthropic id cannot run on the claude CLI — fall to the CLI default', () => {
    setSetting('digest_model_bridge', 'google/gemini-2.5-flash');
    expect(modelForCut('bridge', db)).toBeUndefined();
  });

  it('a bare CLI-style name passes through untouched', () => {
    setSetting('digest_model_ledes', 'claude-opus-5');
    expect(modelForCut('ledes', db)).toBe('claude-opus-5');
  });
});
