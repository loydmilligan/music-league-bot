import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildChatRoster } from '../digest/chatRoster.js';

// Points at the seeded copy produced by scripts/seed-sssc-roster.mjs.
const DB = process.env.SSSC_TEST_DB ?? '/tmp/scr/league.db';

describe('sssc roster', () => {
  it('resolves mapped discord senders to players', () => {
    const db = new Database(DB, { readonly: true });
    const { id } = db.prepare("SELECT id FROM leagues WHERE slug='sssc'").get() as { id: number };
    const roster = buildChatRoster(db, id, ['Dogsweat 🚂', 'MrKlorox', 'zewskers'], 'discord', 'sssc');
    expect(roster.resolve('Dogsweat 🚂')?.unmapped).toBe(false);
    expect(roster.resolve('zewskers')?.unmapped).toBe(false); // = nowlistenallison
  });
});
