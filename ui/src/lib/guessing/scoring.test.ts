import { describe, it, expect } from 'vitest';
import { seedRound, reveal } from './fixtures.js';
import { scoreRound } from './scoring.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ME = 1;

function setFinal(db: any, uri: string, pid: number, confidence = 50) {
  db.prepare(
    `INSERT INTO guess_picks (round_id, spotify_uri, final_pick_player_id, confidence, updated_at)
     VALUES (1, ?, ?, ?, '2026-01-01T00:00:00Z')
     ON CONFLICT(round_id, spotify_uri) DO UPDATE
       SET final_pick_player_id = excluded.final_pick_player_id,
           confidence = excluded.confidence`,
  ).run(uri, pid, confidence);
}
function setGut(db: any, uri: string, pid: number) {
  db.prepare(
    `INSERT INTO guess_picks (round_id, spotify_uri, gut_pick_player_id, updated_at)
     VALUES (1, ?, ?, '2026-01-01T00:00:00Z')
     ON CONFLICT(round_id, spotify_uri) DO UPDATE
       SET gut_pick_player_id = excluded.gut_pick_player_id`,
  ).run(uri, pid);
}

describe('derived scoring', () => {
  it('scores gut and final independently, and refinement can beat instinct', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    reveal(db, { [songs[1]]: players[1], [songs[2]]: players[2], [songs[3]]: players[3] });

    setGut(db, songs[1], players[1]);   // gut right
    setGut(db, songs[2], players[3]);   // gut wrong
    setGut(db, songs[3], players[3]);   // gut right
    setFinal(db, songs[1], players[1]); // stays right
    setFinal(db, songs[2], players[2]); // research fixed it
    setFinal(db, songs[3], players[2]); // research broke it

    const s = scoreRound(db, roundId, ME);
    expect(s.scored).toBe(3);
    expect(s.gutCorrect).toBe(2);
    expect(s.finalCorrect).toBe(2);
    expect(s.songs.find((x) => x.spotifyUri === songs[2])).toMatchObject({
      gutHit: false, finalHit: true,
    });
  });

  it('never scores my own song', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4, mineIndex: 0 });
    reveal(db, { [songs[0]]: players[2], [songs[1]]: players[1] });
    setFinal(db, songs[0], players[2]); // a pick on my own song, which must not score
    const s = scoreRound(db, roundId, ME);
    expect(s.songs.map((x) => x.spotifyUri)).not.toContain(songs[0]);
  });

  it('ignores songs that have not been revealed yet', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    reveal(db, { [songs[1]]: players[1] }); // only one revealed
    setFinal(db, songs[1], players[1]);
    setFinal(db, songs[2], players[2]);
    const s = scoreRound(db, roundId, ME);
    expect(s.scored).toBe(1);
  });

  it('carries comment visibility through for the scorecard cut', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 4, playerCount: 4 });
    db.prepare('UPDATE ml_submissions SET visible_to_voters = 0 WHERE spotify_uri = ?').run(songs[2]);
    reveal(db, { [songs[1]]: players[1], [songs[2]]: players[2] });
    setFinal(db, songs[1], players[1]);
    setFinal(db, songs[2], players[2]);
    const s = scoreRound(db, roundId, ME);
    expect(s.songs.find((x) => x.spotifyUri === songs[1])!.commentWasVisible).toBe(true);
    expect(s.songs.find((x) => x.spotifyUri === songs[2])!.commentWasVisible).toBe(false);
  });

  it('stores nothing — scoring the same round twice cannot drift', () => {
    const { db, roundId, songs, players } = seedRound({ songCount: 3, playerCount: 3 });
    reveal(db, { [songs[1]]: players[1], [songs[2]]: players[2] });
    setFinal(db, songs[1], players[1]);
    const a = scoreRound(db, roundId, ME);
    const b = scoreRound(db, roundId, ME);
    expect(a).toEqual(b);
  });

  /**
   * A single statement naming both ml_submissions and competitor_id is reaching
   * submitter identity, whatever alias it uses. Checked per-SQL-string, not
   * whole-file: a whole-file co-occurrence check false-positives on assignment.ts,
   * which legitimately reads competitor_id from season_standings in one query
   * while a separate query names ml_submissions for spotify_uri only.
   *
   * The `SELECT *` clause is flagged too when it targets ml_submissions: selecting
   * every column exposes competitor_id even when the string never names it —
   * the reflection escape hatch (`SELECT * ...` then `row.competitor_id` in JS).
   */
  function readsSubmitterIdentity(src: string): boolean {
    const sqlStrings = src.match(/`[^`]*`|'[^']*'|"[^"]*"/g) ?? [];
    return sqlStrings.some((q) => {
      if (!/\bml_submissions\b/.test(q)) return false;
      if (/\bcompetitor_id\b/.test(q)) return true;
      if (/select\s+\*/i.test(q)) return true;   // bare SELECT *
      if (/\b\w+\.\*/.test(q)) return true;      // alias.* anywhere, not anchored to SELECT
      return false;
    });
  }

  describe('readsSubmitterIdentity (guard detector, unit-tested directly)', () => {
    const bad: [string, string][] = [
      ['aliased ms.', "db.prepare(`SELECT ms.competitor_id FROM ml_submissions ms`)"],
      ['aliased s. (not "ms")', "db.prepare(`SELECT s.competitor_id AS actual FROM ml_submissions s`)"],
      ['aliased sub. with a JOIN before the column', "db.prepare(`SELECT sub.competitor_id FROM ml_submissions sub JOIN votes v ON v.round_id = sub.round_id`)"],
      ['unaliased, column before FROM', "db.prepare(`SELECT competitor_id FROM ml_submissions WHERE round_id = ?`)"],
      ['reflection via SELECT *', "db.prepare(`SELECT * FROM ml_submissions WHERE round_id = ?`)"],
      ['reflection via alias-qualified SELECT ms.*', "db.prepare(`SELECT ms.* FROM ml_submissions ms`)"],
      ['reflection via DISTINCT before the alias-qualified star', "db.prepare(`SELECT DISTINCT ms.* FROM ml_submissions ms`)"],
      ['reflection via a leading column before the alias-qualified star', "db.prepare(`SELECT id, ms.* FROM ml_submissions ms`)"],
    ];
    for (const [label, src] of bad) {
      it(`flags: ${label}`, () => {
        expect(readsSubmitterIdentity(src)).toBe(true);
      });
    }

    const clean: [string, string][] = [
      ['ml_submissions and competitor_id in separate query strings (assignment.ts shape)',
        "db.prepare(`SELECT ms.spotify_uri FROM ml_submissions ms`); db.prepare(`SELECT ss.competitor_id FROM season_standings ss`)"],
      ['competitor_id from an unrelated table, no ml_submissions anywhere',
        "db.prepare(`SELECT competitor_id FROM season_standings`)"],
      ['ml_submissions referenced with neither competitor_id nor SELECT *',
        "db.prepare(`SELECT spotify_uri, title FROM ml_submissions WHERE round_id = ?`)"],
      ['COUNT(*) is not a star-select — must not be confused with reflection',
        "db.prepare(`SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?`)"],
    ];
    for (const [label, src] of clean) {
      it(`does not flag: ${label}`, () => {
        expect(readsSubmitterIdentity(src)).toBe(false);
      });
    }
  });

  it('no live-phase module can read submitter identity (spec §5)', () => {
    const dir = join(process.cwd(), 'src/lib/guessing');
    const allowed = new Set(['scoring.ts', 'sync.ts', 'fixtures.ts']);
    const offenders: string[] = [];

    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || allowed.has(f)) continue;
      const src = readFileSync(join(dir, f), 'utf8');
      if (readsSubmitterIdentity(src)) offenders.push(f);
    }
    expect(offenders, `these modules reach submitter identity: ${offenders.join(', ')}`).toEqual([]);
  });
});
