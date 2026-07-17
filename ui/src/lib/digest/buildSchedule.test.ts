import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { buildSchedule } from './schedule.js';
import { claimSend, markSent } from './sendLog.js';

const NOW = '2026-07-17T09:00:00Z';
const PAST = '2026-07-10T00:00:00Z';
const FUTURE = '2026-07-24T00:00:00Z';

let db: Database.Database;
beforeEach(() => {
  db = openLeagueDb(':memory:');
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'fam-jam', 'Fam Jam')`).run();
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`,
  ).run();
  db.prepare(`INSERT INTO competitors (id, ml_competitor_id, name) VALUES (1, 'c1', 'Alice')`).run();
  // Round 1 finished; round 2 exists (so round 1 is not season-final) but is open.
  for (const [id, dl] of [
    [1, PAST],
    [2, FUTURE],
  ] as [number, string][]) {
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, description, voting_deadline, created_at)
       VALUES (?, 1, ?, ?, 'A theme', ?, '2026-06-01T00:00:00Z')`,
    ).run(id, `r${id}`, `Round ${id}`, dl);
  }
  db.prepare(
    `INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
     VALUES (1, 1, 'spotify:track:a', 'T', 'A', '2026-06-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at)
     VALUES (1, 1, 'spotify:track:a', 5, 'x', '2026-06-01T00:00:00Z')`,
  ).run();
  // A finalized digest — the human-approval gate the auto-poster requires.
  db.prepare(
    `INSERT INTO digest_drafts (id, round_id, finalized_at, rel_context, prep_checks)
     VALUES ('d1', 1, '2026-07-12T00:00:00Z', '{}', '[]')`,
  ).run();
});

describe('buildSchedule', () => {
  it('returns one entry per league', () => {
    const s = buildSchedule(db, NOW);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ leagueId: 1, leagueSlug: 'fam-jam' });
  });

  it('surfaces a sendable round', () => {
    expect(buildSchedule(db, NOW)[0]).toMatchObject({ action: 'send', roundId: 1 });
  });

  it('carries the round name for the message body', () => {
    expect(buildSchedule(db, NOW)[0].roundName).toBe('Round 1');
  });

  it('stops offering a round once it has been sent', () => {
    claimSend(db, 1, 1, NOW);
    markSent(db, 1, { sentAt: NOW, target: 'x@g.us', url: 'u' });

    const entry = buildSchedule(db, NOW)[0];
    expect(entry.action).toBe('none');
    expect(entry.reason).toMatch(/already sent/i);
  });

  it('still offers a round that is claimed but not confirmed sent', () => {
    // The claim is the duplicate guard; the schedule should not double-gate it.
    claimSend(db, 1, 1, NOW);
    expect(buildSchedule(db, NOW)[0].action).toBe('send');
  });

  it('reports a league with nothing to do', () => {
    db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (2, 'empty', 'Empty')`).run();
    const entry = buildSchedule(db, NOW).find((e) => e.leagueSlug === 'empty');
    expect(entry).toMatchObject({ action: 'none' });
  });
});
