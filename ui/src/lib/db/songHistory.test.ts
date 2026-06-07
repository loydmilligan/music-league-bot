import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getSongStatusBatch } from './songHistory.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

function competitor(mlId: string, name: string): number {
  return (db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?) RETURNING id').get(mlId, name) as { id: number }).id;
}
function round(season: number): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, season, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId: `r-${season}`, name: `Round ${season}`, description: '',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
}
function submit(roundId: number, competitorId: number | null, uri: string, artists: string): void {
  db.prepare(`INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
    VALUES (?,?,?,?,?,?)`).run(roundId, competitorId, uri, 'T', artists, new Date().toISOString());
}
function vote(roundId: number, voterId: number, uri: string, pts: number): void {
  db.prepare(`INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at)
    VALUES (?,?,?,?,?)`).run(roundId, voterId, uri, pts, new Date().toISOString());
}

beforeEach(() => { db = openLeagueDb(':memory:'); });

it('returns a blank status for an unknown song', () => {
  const res = getSongStatusBatch(db, [{ uri: 'spotify:track:clean', artist: 'Nobody' }], 'me');
  expect(res['spotify:track:clean']).toEqual({
    submittedByMe: false, submittedByOthers: [], artistSubmittedByMe: false, chatMentions: [],
  });
});

it('flags submittedByMe and excludes my appearance from submittedByOthers', () => {
  const me = competitor('me', 'Me');
  const r = round(1);
  submit(r, me, 'spotify:track:mine', 'Radiohead');
  const res = getSongStatusBatch(db, [{ uri: 'spotify:track:mine', artist: 'Radiohead' }], 'me');
  expect(res['spotify:track:mine'].submittedByMe).toBe(true);
  expect(res['spotify:track:mine'].submittedByOthers).toEqual([]);
  // artist I've submitted → orange signal
  expect(res['spotify:track:mine'].artistSubmittedByMe).toBe(true);
});

it('reports others submissions with league/season/round/by/points', () => {
  const me = competitor('me', 'Me');
  const them = competitor('them', 'Them');
  const r = round(2);
  submit(r, them, 'spotify:track:theirs', 'Beck');
  vote(r, me, 'spotify:track:theirs', 5);
  const res = getSongStatusBatch(db, [{ uri: 'spotify:track:theirs', artist: 'Beck' }], 'me');
  const s = res['spotify:track:theirs'];
  expect(s.submittedByMe).toBe(false);
  expect(s.submittedByOthers).toHaveLength(1);
  expect(s.submittedByOthers[0]).toMatchObject({ league: 'Hip Jammers', season: 2, round: 'Round 2', by: 'Them', points: 5 });
  expect(s.artistSubmittedByMe).toBe(false);
});

it('matches artistSubmittedByMe on first artist, case-insensitively', () => {
  const me = competitor('me', 'Me');
  const r = round(3);
  submit(r, me, 'spotify:track:a', 'The Beatles, Billy Preston');
  const res = getSongStatusBatch(db, [{ uri: 'spotify:track:other', artist: 'the beatles' }], 'me');
  expect(res['spotify:track:other'].artistSubmittedByMe).toBe(true);
  expect(res['spotify:track:other'].submittedByMe).toBe(false);
});

it('returns chat mentions with sender and quote', () => {
  db.prepare(`INSERT INTO chat_songs (id, spotify_uri, artist, title) VALUES (?,?,?,?)`)
    .run('cs1', 'spotify:track:chat', 'Wilco', 'Song');
  db.prepare(`INSERT INTO chat_mentions (id, song_id, chat_name, sender_name, captured_at, raw_message)
    VALUES (?,?,?,?,?,?)`).run('cm1', 'cs1', 'Fam', 'Dave', '2026-01-01T00:00:00Z', 'we have to play this');
  const res = getSongStatusBatch(db, [{ uri: 'spotify:track:chat', artist: 'Wilco' }], 'me');
  expect(res['spotify:track:chat'].chatMentions).toEqual([{ by: 'Dave', quote: 'we have to play this' }]);
});

it('resolves a whole batch in one call and keeps every requested key', () => {
  const me = competitor('me', 'Me');
  const r = round(4);
  submit(r, me, 'spotify:track:x', 'A');
  const res = getSongStatusBatch(db, [
    { uri: 'spotify:track:x', artist: 'A' },
    { uri: 'spotify:track:y', artist: 'B' },
  ], 'me');
  expect(Object.keys(res).sort()).toEqual(['spotify:track:x', 'spotify:track:y']);
  expect(res['spotify:track:x'].submittedByMe).toBe(true);
  expect(res['spotify:track:y'].submittedByMe).toBe(false);
});
