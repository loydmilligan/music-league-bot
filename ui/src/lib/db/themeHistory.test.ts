import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getThemeHistory } from './themeHistory.js';
import type Database from 'better-sqlite3';

let db: Database.Database;

function competitor(mlId: string, name: string): number {
  return (db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?) RETURNING id').get(mlId, name) as { id: number }).id;
}
function round(season: number, name: string, description: string): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, season, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId: `r-${season}-${name}`, name, description,
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
}
function submit(roundId: number, competitorId: number | null, uri: string, title: string, artists: string): void {
  db.prepare(`INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
    VALUES (?,?,?,?,?,?)`).run(roundId, competitorId, uri, title, artists, new Date().toISOString());
}
function vote(roundId: number, voterId: number, uri: string, pts: number): void {
  db.prepare(`INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at)
    VALUES (?,?,?,?,?)`).run(roundId, voterId, uri, pts, new Date().toISOString());
}

beforeEach(() => { db = openLeagueDb(':memory:'); });

it('returns an empty array when there are no rounds', () => {
  expect(getThemeHistory(db)).toEqual([]);
});

it('returns theme=prompt, round=title, season, and its picks', () => {
  const me = competitor('me', 'Me');
  const r = round(1, 'Weatherbug', 'Songs with weather-related lyrics.');
  submit(r, me, 'spotify:track:rain', 'Rain', 'The Beatles');
  vote(r, me, 'spotify:track:rain', 7);

  const out = getThemeHistory(db);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ theme: 'Songs with weather-related lyrics.', season: 1, round: 'Weatherbug' });
  expect(out[0].picks).toEqual([{ title: 'Rain', artist: 'The Beatles', submitter: 'Me', points: 7 }]);
});

it('strips the "Theme provided by" attribution from the prompt', () => {
  round(1, 'Get Pumped', 'Songs that pump you up\n\nTheme provided by: Brian');
  expect(getThemeHistory(db)[0].theme).toBe('Songs that pump you up');
});

it('orders picks highest-points first and labels anonymous submitters', () => {
  const me = competitor('me', 'Me');
  const r = round(1, 'Show Off', 'A song.');
  submit(r, me, 'spotify:track:lo', 'Low', 'A');
  vote(r, me, 'spotify:track:lo', 2);
  submit(r, null, 'spotify:track:hi', 'High', 'B'); // anonymous ingest
  vote(r, me, 'spotify:track:hi', 9);

  const picks = getThemeHistory(db)[0].picks;
  expect(picks.map((p) => p.title)).toEqual(['High', 'Low']);
  expect(picks[0]).toMatchObject({ submitter: 'Unknown', points: 9 });
});

it('falls back to the round title when the prompt is empty', () => {
  round(1, 'Mystery', '');
  expect(getThemeHistory(db)[0].theme).toBe('Mystery');
});
