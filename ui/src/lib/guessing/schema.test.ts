import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';

function cols(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
}

describe('guess spine schema', () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA);

  it('creates all five guess tables', () => {
    for (const t of [
      'guess_round_state',
      'guess_picks',
      'guess_candidates',
      'guess_ai_distribution',
      'guess_ai_song',
    ]) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
      expect(row, `${t} missing`).toBeTruthy();
    }
  });

  it('guess_picks carries both picks, confidence and both comment fields', () => {
    expect(cols(db, 'guess_picks')).toEqual(
      expect.arrayContaining([
        'round_id', 'spotify_uri', 'gut_pick_player_id', 'final_pick_player_id',
        'confidence', 'second_pick_player_id', 'explanation', 'second_explanation',
        'comment', 'comment_notes', 'locked_at', 'updated_at',
      ]),
    );
  });

  it('has NO stored correctness column anywhere — scoring is derived', () => {
    for (const t of ['guess_picks', 'guess_candidates', 'guess_round_state']) {
      const names = cols(db, t).join(',');
      expect(names).not.toMatch(/correct|accura|score/i);
    }
  });

  it('candidate status is constrained to the three states', () => {
    db.exec(`INSERT INTO leagues (id,slug,name) VALUES (1,'l','L');
             INSERT INTO seasons (id,league_id,season_number,status) VALUES (1,1,1,'active');
             INSERT INTO rounds (id,season_id,ml_round_id,name,created_at) VALUES (1,1,'m1','R1','2026-01-01');
             INSERT INTO competitors (id,ml_competitor_id,name) VALUES (1,'c1','A');`);
    expect(() =>
      db.prepare(
        `INSERT INTO guess_candidates (round_id,spotify_uri,player_id,status,updated_at)
         VALUES (1,'spotify:track:x',1,'bogus','2026-01-01')`,
      ).run(),
    ).toThrow();
  });

  it('confidence and certainty are rejected outside 0..100', () => {
    expect(() =>
      db.prepare(
        `INSERT INTO guess_picks (round_id,spotify_uri,confidence,updated_at)
         VALUES (1,'spotify:track:y',101,'2026-01-01')`,
      ).run(),
    ).toThrow();
  });

  it('guess_round_state carries rehearsal mode and horizon', () => {
    expect(cols(db, 'guess_round_state')).toEqual(expect.arrayContaining(['mode', 'as_of']));
  });

  it('mode is constrained to live/rehearsal', () => {
    expect(() =>
      db.prepare(
        `INSERT INTO guess_round_state (round_id, mode, updated_at)
         VALUES (99,'bogus','2026-01-01')`,
      ).run(),
    ).toThrow();
  });

  it('guess_round_state can record why a comment fetch failed', () => {
    db.prepare(
      `INSERT INTO guess_round_state (round_id, updated_at, comments_error)
       VALUES (1, '2026-01-01T00:00:00Z', 'session expired')`,
    ).run();
    const row = db.prepare('SELECT comments_error FROM guess_round_state WHERE round_id = 1').get() as
      { comments_error: string | null };
    expect(row.comments_error).toBe('session expired');
  });
});
