import { describe, it, expect } from 'vitest';
import { seedRound, seedPriorRound, seedVote, seedChat, CHAT_GROUP } from './fixtures.js';

describe('fixture extensions', () => {
  it('seeds a prior round in the same season', () => {
    const { db } = seedRound();
    seedPriorRound(db, 2, '2025-12-01T00:00:00Z');
    const r = db.prepare('SELECT season_id AS s, voting_deadline AS d FROM rounds WHERE id = 2')
      .get() as { s: number; d: string };
    expect(r.s).toBe(1);
    expect(r.d).toBe('2025-12-01T00:00:00Z');
  });

  it('seeds votes with a voter and comment', () => {
    const { db, songs } = seedRound();
    seedVote(db, 1, 2, songs[1], 'sounds like steiny', '2026-01-01T12:00:00Z');
    const v = db.prepare('SELECT voter_id AS v, comment AS c FROM votes WHERE round_id = 1')
      .get() as { v: number; c: string };
    expect(v.v).toBe(2);
    expect(v.c).toBe('sounds like steiny');
  });

  it('creates chat_messages on demand — it is absent from the UI SCHEMA', () => {
    const { db } = seedRound();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'").get(),
    ).toBeFalsy();

    seedChat(db, CHAT_GROUP, 'Steiny', 'i never comment', '2026-01-01T09:00:00Z');

    const m = db.prepare('SELECT sender AS s, ts FROM chat_messages').get() as { s: string; ts: string };
    expect(m.s).toBe('Steiny');
    expect(m.ts).toBe('2026-01-01T09:00:00Z');
  });

  it('seedChat is idempotent about the table', () => {
    const { db } = seedRound();
    seedChat(db, CHAT_GROUP, 'A', 'one', '2026-01-01T09:00:00Z');
    seedChat(db, CHAT_GROUP, 'B', 'two', '2026-01-01T10:00:00Z');
    const n = db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as { c: number };
    expect(n.c).toBe(2);
  });
});
