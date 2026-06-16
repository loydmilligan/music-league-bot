import { describe, it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound, getRoundStoredPhase, endSubmissionPhase, endVotingPhase } from './rounds.js';
import type Database from 'better-sqlite3';

function mkRound(db: Database.Database, mlId: string, phase: string, extra: Record<string, string | null> = {}): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 99, 'active');
  const id = upsertRound(db, seasonId, {
    mlRoundId: mlId, name: mlId, description: '',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
  db.prepare('UPDATE rounds SET phase=? WHERE id=?').run(phase, id);
  for (const [col, val] of Object.entries(extra)) {
    db.prepare(`UPDATE rounds SET ${col}=? WHERE id=?`).run(val, id);
  }
  return id;
}

function mkSeason(db: Database.Database): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  return upsertSeason(db, leagueId, 100, 'active');
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

// ── getRoundStoredPhase ───────────────────────────────────────────────────────

describe('getRoundStoredPhase', () => {
  it('reads the stored phase column', () => {
    const id = mkRound(db, 'r1', 'submission');
    expect(getRoundStoredPhase(db, id)).toBe('submission');
  });

  it('returns null for an unknown round id', () => {
    expect(getRoundStoredPhase(db, 99999)).toBeNull();
  });
});

// ── endSubmissionPhase ────────────────────────────────────────────────────────

describe('endSubmissionPhase', () => {
  it('accelerated mode: flips submission→voting, leaves voting_deadline unchanged', () => {
    const id = mkRound(db, 'r1', 'submission', { voting_deadline: '2026-06-20T00:00:00.000Z' });
    const result = endSubmissionPhase(db, id, {
      endTimestamp: '2026-06-17T00:00:00.000Z',
      mode: 'accelerated',
    });
    expect(getRoundStoredPhase(db, id)).toBe('voting');
    expect(result.votingDeadline).toBe('2026-06-20T00:00:00.000Z');
  });

  it('speedy mode: flips submission→voting and shifts voting_deadline by speedyDays', () => {
    const id = mkRound(db, 'r1', 'submission');
    const result = endSubmissionPhase(db, id, {
      endTimestamp: '2026-06-17T00:00:00.000Z',
      mode: 'speedy',
      speedyDays: 3,
    });
    expect(getRoundStoredPhase(db, id)).toBe('voting');
    // 2026-06-17T00:00:00Z + 3d = 2026-06-20T00:00:00.000Z
    expect(result.votingDeadline).toBe('2026-06-20T00:00:00.000Z');
  });

  it('speedy mode: defaults speedyDays to 3 when omitted', () => {
    const id = mkRound(db, 'r1', 'submission');
    const result = endSubmissionPhase(db, id, {
      endTimestamp: '2026-06-17T00:00:00.000Z',
      mode: 'speedy',
    });
    expect(result.votingDeadline).toBe('2026-06-20T00:00:00.000Z');
  });

  it('throws 422 when current phase is not submission (e.g. voting)', () => {
    const id = mkRound(db, 'r1', 'voting');
    expect(() =>
      endSubmissionPhase(db, id, { endTimestamp: '2026-06-17T00:00:00.000Z', mode: 'accelerated' }),
    ).toThrowError(/illegal transition/);
  });

  it('throws 422 when current phase is complete', () => {
    const id = mkRound(db, 'r1', 'complete');
    expect(() =>
      endSubmissionPhase(db, id, { endTimestamp: '2026-06-17T00:00:00.000Z', mode: 'accelerated' }),
    ).toThrowError(/illegal transition/);
  });

  it('throws 404 for unknown round', () => {
    expect(() =>
      endSubmissionPhase(db, 99999, { endTimestamp: '2026-06-17T00:00:00.000Z', mode: 'accelerated' }),
    ).toThrowError(/round not found/);
  });

  it('thrown 422 has .status property', () => {
    const id = mkRound(db, 'r1', 'voting');
    let caught: unknown;
    try {
      endSubmissionPhase(db, id, { endTimestamp: '2026-06-17T00:00:00.000Z', mode: 'accelerated' });
    } catch (e) { caught = e; }
    expect((caught as any).status).toBe(422);
  });
});

// ── endVotingPhase ────────────────────────────────────────────────────────────

describe('endVotingPhase', () => {
  it('flips voting→complete', () => {
    const id = mkRound(db, 'r1', 'voting');
    endVotingPhase(db, id);
    expect(getRoundStoredPhase(db, id)).toBe('complete');
  });

  it('returns next round submission_deadline as prefill', () => {
    const seasonId = mkSeason(db);
    const r1 = upsertRound(db, seasonId, {
      mlRoundId: 'pv-r1', name: 'R1', description: '', spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
    });
    const r2 = upsertRound(db, seasonId, {
      mlRoundId: 'pv-r2', name: 'R2', description: '', spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
    });
    db.prepare("UPDATE rounds SET phase='voting' WHERE id=?").run(r1);
    db.prepare("UPDATE rounds SET submission_deadline='2026-06-26T00:00:00.000Z' WHERE id=?").run(r2);

    const result = endVotingPhase(db, r1);
    expect(result.nextSubmissionDeadline).toBe('2026-06-26T00:00:00.000Z');
  });

  it('returns null nextSubmissionDeadline when this is the last round in the season', () => {
    const id = mkRound(db, 'r1', 'voting');
    const result = endVotingPhase(db, id);
    expect(result.nextSubmissionDeadline).toBeNull();
  });

  it('throws 422 when current phase is not voting (e.g. submission)', () => {
    const id = mkRound(db, 'r1', 'submission');
    expect(() => endVotingPhase(db, id)).toThrowError(/illegal transition/);
  });

  it('throws 422 when current phase is complete', () => {
    const id = mkRound(db, 'r1', 'complete');
    expect(() => endVotingPhase(db, id)).toThrowError(/illegal transition/);
  });

  it('throws 404 for unknown round', () => {
    expect(() => endVotingPhase(db, 99999)).toThrowError(/round not found/);
  });

  it('thrown 404 has .status property', () => {
    let caught: unknown;
    try { endVotingPhase(db, 99999); } catch (e) { caught = e; }
    expect((caught as any).status).toBe(404);
  });
});
