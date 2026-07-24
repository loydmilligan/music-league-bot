import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '../db/schema.js';
import { ingestPlaylist } from '../import/playlistIngest.js';
import { buildLabData } from './labData.js';

function dbWithRound() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'test', 'Test')`).run();
  db.prepare(`INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active')`).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, description, created_at, phase)
     VALUES (100, 10, 'ml-100', 'R1', '', '2026-07-01T00:00:00Z', 'voting')`,
  ).run();
  return db;
}

it('loading a round from its Spotify playlist produces anonymous rows that buildLabData returns', async () => {
  const db = dbWithRound();
  const tracks = [
    { spotifyUri: 'spotify:track:a', title: 'Song A', artist: 'Artist A', album: 'Album A' },
    { spotifyUri: 'spotify:track:b', title: 'Song B', artist: 'Artist B', album: null },
  ];

  const result = await ingestPlaylist(100, 'https://open.spotify.com/playlist/test', {
    db,
    tracksProvider: async () => tracks,
  });
  expect(result).toEqual({ inserted: 2, skipped: 0 });

  // No submitter identity anywhere in ml_submissions for this round.
  const anon = db
    .prepare(`SELECT COUNT(*) n FROM ml_submissions WHERE round_id = 100 AND competitor_id IS NULL`)
    .get() as { n: number };
  expect(anon.n).toBe(2);

  const data = buildLabData(db, 100);
  expect(data.rows).toHaveLength(2);
  const titles = data.rows.map((r) => r.song.title).sort();
  expect(titles).toEqual(['Song A', 'Song B']);
  // LabSong has no submitter-identity field to leak in the first place;
  // this is the anonymity contract's shape-level guarantee.
  for (const row of data.rows) {
    expect(row.song).not.toHaveProperty('competitorId');
    expect(row.song).not.toHaveProperty('submitterId');
  }
  db.close();
});
