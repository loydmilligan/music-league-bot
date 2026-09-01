import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedRound } from './fixtures.js';
import { getRoundState } from './state.js';
import { startRehearsal, priorRoundIds, archiveRehearsal } from './rehearsal.js';

function ballotRows(db: import('better-sqlite3').Database, roundId: number) {
  return db.prepare(
    'SELECT spotify_uri AS uri, is_mine FROM voting_lab_ballot WHERE round_id = ? ORDER BY spotify_uri',
  ).all(roundId) as { uri: string; is_mine: number }[];
}

function stateRow(db: import('better-sqlite3').Database, roundId: number) {
  return db.prepare('SELECT mode, as_of FROM guess_round_state WHERE round_id = ?')
    .get(roundId) as { mode: string; as_of: string | null } | undefined;
}

describe('startRehearsal', () => {
  it('sets mode to rehearsal and stores as_of; phase stays gut', () => {
    const { db, roundId } = seedRound();
    startRehearsal(db, roundId, '2026-02-01T00:00:00Z');
    const row = stateRow(db, roundId)!;
    expect(row.mode).toBe('rehearsal');
    expect(row.as_of).toBe('2026-02-01T00:00:00Z');
    expect(getRoundState(db, roundId).phase).toBe('gut');
  });

  it('creates a ballot row per song, every one with is_mine = 0 (spec §14.4)', () => {
    // seedRound already inserts voting_lab_ballot rows (with is_mine set from
    // mineIndex) as part of its own fixture — clear them first so this test
    // exercises startRehearsal's own creation path against a round with NO
    // ballot rows, exactly like the real 148/149 subjects.
    const { db, roundId, songs } = seedRound({ songCount: 4 });
    db.prepare('DELETE FROM voting_lab_ballot WHERE round_id = ?').run(roundId);
    startRehearsal(db, roundId, '2026-02-01T00:00:00Z');
    const rows = ballotRows(db, roundId);
    expect(rows).toHaveLength(songs.length);
    expect(rows.every((r) => r.is_mine === 0)).toBe(true);
  });

  it('is idempotent: a second call does not change row count and does not reset an existing is_mine=1 mark', () => {
    const { db, roundId, songs } = seedRound({ songCount: 4 });
    db.prepare('DELETE FROM voting_lab_ballot WHERE round_id = ?').run(roundId);
    startRehearsal(db, roundId, '2026-02-01T00:00:00Z');
    // Matt marks his own song, same gesture as live.
    db.prepare('UPDATE voting_lab_ballot SET is_mine = 1 WHERE round_id = ? AND spotify_uri = ?')
      .run(roundId, songs[0]);

    startRehearsal(db, roundId, '2026-02-01T00:00:00Z');

    const rows = ballotRows(db, roundId);
    expect(rows).toHaveLength(songs.length);
    expect(rows.find((r) => r.uri === songs[0])!.is_mine).toBe(1);
  });
});

describe('priorRoundIds', () => {
  it('returns only strictly-earlier rounds in the same league, excluding the round itself and NULL-deadline rounds', () => {
    const { db, roundId } = seedRound(); // round 1, league 1, no explicit voting_deadline
    db.prepare('UPDATE rounds SET voting_deadline = ? WHERE id = ?').run('2026-03-10T00:00:00Z', roundId);

    // An earlier round in the same league — should be included.
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, voting_deadline)
       VALUES (2, 1, 'ml-2', 'Earlier', '2026-01-01T00:00:00Z', '2026-02-10T00:00:00Z')`,
    ).run();

    // A later round in the same league — must be excluded.
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, voting_deadline)
       VALUES (3, 1, 'ml-3', 'Later', '2026-01-01T00:00:00Z', '2026-04-10T00:00:00Z')`,
    ).run();

    // An earlier round with a NULL voting_deadline — must be excluded.
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
       VALUES (4, 1, 'ml-4', 'No deadline', '2026-01-01T00:00:00Z')`,
    ).run();

    expect(priorRoundIds(db, roundId)).toEqual([2]);
  });

  it('scopes by league, not season — an earlier round in a different league is excluded', () => {
    const { db, roundId } = seedRound();
    db.prepare('UPDATE rounds SET voting_deadline = ? WHERE id = ?').run('2026-03-10T00:00:00Z', roundId);

    db.exec(`INSERT INTO leagues (id,slug,name) VALUES (2,'other','Other');
             INSERT INTO seasons (id,league_id,season_number,status) VALUES (2,2,1,'active');`);
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at, voting_deadline)
       VALUES (5, 2, 'ml-5', 'Other league earlier', '2026-01-01T00:00:00Z', '2026-02-10T00:00:00Z')`,
    ).run();

    expect(priorRoundIds(db, roundId)).toEqual([]);
  });
});

describe('archiveRehearsal', () => {
  it('returns every stored pick/candidate and leaves zero rows for the round in all five tables', () => {
    const { db, roundId } = seedRound();
    startRehearsal(db, roundId, '2026-02-01T00:00:00Z');
    db.prepare(
      `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
       VALUES (?, 'spotify:track:s1', 2, '2026-01-01T00:00:00Z')`,
    ).run(roundId);
    db.prepare(
      `INSERT INTO guess_candidates (round_id, spotify_uri, player_id, updated_at)
       VALUES (?, 'spotify:track:s1', 2, '2026-01-01T00:00:00Z')`,
    ).run(roundId);
    db.prepare(
      `INSERT INTO guess_ai_distribution (round_id, spotify_uri, player_id, pct, generated_at)
       VALUES (?, 'spotify:track:s1', 2, 0.5, '2026-01-01T00:00:00Z')`,
    ).run(roundId);
    db.prepare(
      `INSERT INTO guess_ai_song (round_id, spotify_uri, ai_pick_player_id, generated_at)
       VALUES (?, 'spotify:track:s1', 2, '2026-01-01T00:00:00Z')`,
    ).run(roundId);

    const archive = archiveRehearsal(db, roundId);

    expect(archive.roundId).toBe(roundId);
    expect(archive.asOf).toBe('2026-02-01T00:00:00Z');
    expect(archive.picks).toHaveLength(1);
    expect(archive.candidates).toHaveLength(1);
    expect(archive.aiDistribution).toHaveLength(1);
    expect(archive.aiSong).toHaveLength(1);
    expect(archive.state).toBeTruthy();

    for (const t of ['guess_picks', 'guess_candidates', 'guess_ai_distribution', 'guess_ai_song', 'guess_round_state']) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE round_id = ?`).get(roundId) as { n: number };
      expect(row.n, `${t} not cleared`).toBe(0);
    }
  });

  it('leaves other rounds untouched', () => {
    const { db, roundId } = seedRound();
    startRehearsal(db, roundId, '2026-02-01T00:00:00Z');
    db.prepare(
      `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
       VALUES (?, 'spotify:track:s1', 2, '2026-01-01T00:00:00Z')`,
    ).run(roundId);

    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
       VALUES (2, 1, 'ml-2', 'Other round', '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
       VALUES (2, 'spotify:track:other', 2, '2026-01-01T00:00:00Z')`,
    ).run();

    archiveRehearsal(db, roundId);

    const other = db.prepare('SELECT COUNT(*) AS n FROM guess_picks WHERE round_id = 2').get() as { n: number };
    expect(other.n).toBe(1);
  });

  // spec §14.7: serialize, THEN delete — a failed write must never lose data
  // that is already gone. These two cases are made genuinely distinguishable
  // by pointing persistTo at a real writable dir vs. one that cannot be
  // written to, not by mocking fs — the same standard held all day.
  describe('persistTo', () => {
    it('writes the archive to disk before deleting, and the file matches what is returned', () => {
      const { db, roundId } = seedRound();
      startRehearsal(db, roundId, '2026-02-01T00:00:00Z');
      db.prepare(
        `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
         VALUES (?, 'spotify:track:s1', 2, '2026-01-01T00:00:00Z')`,
      ).run(roundId);

      const dir = mkdtempSync(join(tmpdir(), 'guess-archive-'));
      const path = join(dir, `${roundId}.json`);

      const archive = archiveRehearsal(db, roundId, path);

      const onDisk = JSON.parse(readFileSync(path, 'utf8')) as typeof archive;
      expect(onDisk.roundId).toBe(roundId);
      expect(onDisk.picks).toHaveLength(1);
      expect(onDisk).toEqual(archive);

      const row = db.prepare('SELECT COUNT(*) AS n FROM guess_picks WHERE round_id = ?').get(roundId) as { n: number };
      expect(row.n).toBe(0);
    });

    it('leaves the rows in place when the write fails', () => {
      const { db, roundId } = seedRound();
      startRehearsal(db, roundId, '2026-02-01T00:00:00Z');
      db.prepare(
        `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
         VALUES (?, 'spotify:track:s1', 2, '2026-01-01T00:00:00Z')`,
      ).run(roundId);

      // A parent directory that genuinely does not exist — writeFileSync
      // does not create parents, so this throws ENOENT before the delete
      // transaction ever runs.
      const badPath = join(tmpdir(), 'guess-archive-does-not-exist', `${roundId}.json`);

      expect(() => archiveRehearsal(db, roundId, badPath)).toThrow();

      const row = db.prepare('SELECT COUNT(*) AS n FROM guess_picks WHERE round_id = ?').get(roundId) as { n: number };
      expect(row.n).toBe(1);
      const state = db.prepare('SELECT COUNT(*) AS n FROM guess_round_state WHERE round_id = ?').get(roundId) as { n: number };
      expect(state.n).toBe(1);
    });
  });
});
