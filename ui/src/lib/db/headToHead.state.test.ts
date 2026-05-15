import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { addResearchSong, updateResearchSong } from './research.js';
import { buildH2HState, recordH2HMatch, clearH2HMatches } from './headToHead.js';
import type Database from 'better-sqlite3';

function mkRound(db: Database.Database): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 99, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId: 'state-test', name: 'state', description: '', spotifyPlaylistUrl: '',
    createdAt: new Date().toISOString(),
  });
}

function addSong(db: Database.Database, roundId: number, uri: string, theme: number): number {
  const row = addResearchSong(db, { roundId, spotifyUri: uri, title: uri, artist: 'X', album: null });
  updateResearchSong(db, row.id, { themeFit: theme, discoveryPotential: theme, personalRating: theme, nostalgiaPotential: theme });
  return row.id;
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('cold-start state: champion = highest-scored candidate, queue holds the rest', () => {
  const r = mkRound(db);
  const a = addSong(db, r, 'a', 5);
  const b = addSong(db, r, 'b', 3);
  const c = addSong(db, r, 'c', 4);
  const s = buildH2HState(db, r);
  expect(s.champion?.id).toBe(a);
  expect(s.challenger?.id).toBe(c); // higher than b
  expect(s.queue.map(q => q.id)).toEqual([c, b]);
  expect(s.retired).toEqual([]);
  expect(s.isComplete).toBe(false);
});

it('after the champion wins one match: loser retired, champion holds, queue shrinks', () => {
  const r = mkRound(db);
  const a = addSong(db, r, 'a', 5);
  const b = addSong(db, r, 'b', 4);
  const c = addSong(db, r, 'c', 3);
  recordH2HMatch(db, r, a, b);
  const s = buildH2HState(db, r);
  expect(s.champion?.id).toBe(a);
  expect(s.retired.map(x => x.id)).toEqual([b]);
  expect(s.queue.map(q => q.id)).toEqual([c]);
  expect(s.challenger?.id).toBe(c);
  expect(s.isComplete).toBe(false);
});

it('a challenger dethrones the champion: new champion installed, old one retired', () => {
  const r = mkRound(db);
  const a = addSong(db, r, 'a', 5);
  const b = addSong(db, r, 'b', 4);
  const c = addSong(db, r, 'c', 3);
  recordH2HMatch(db, r, b, a); // upset
  const s = buildH2HState(db, r);
  expect(s.champion?.id).toBe(b);
  expect(s.retired.map(x => x.id)).toEqual([a]);
  expect(s.queue.map(q => q.id)).toEqual([c]);
});

it('isComplete when every other candidate has been retired', () => {
  const r = mkRound(db);
  const a = addSong(db, r, 'a', 5);
  const b = addSong(db, r, 'b', 4);
  recordH2HMatch(db, r, a, b);
  const s = buildH2HState(db, r);
  expect(s.champion?.id).toBe(a);
  expect(s.queue).toEqual([]);
  expect(s.isComplete).toBe(true);
});

it('clearH2HMatches resets the round back to cold start', () => {
  const r = mkRound(db);
  const a = addSong(db, r, 'a', 5);
  const b = addSong(db, r, 'b', 4);
  recordH2HMatch(db, r, a, b);
  expect(clearH2HMatches(db, r)).toBe(1);
  const s = buildH2HState(db, r);
  expect(s.matches).toEqual([]);
  expect(s.retired).toEqual([]);
  expect(s.queue.map(q => q.id)).toEqual([b]);
});

it('candidates with no eligible status are absent from state entirely', () => {
  const r = mkRound(db);
  const a = addSong(db, r, 'a', 5);
  const b = addSong(db, r, 'b', 4);
  db.prepare("UPDATE research_songs SET status='banked' WHERE id=?").run(b);
  const s = buildH2HState(db, r);
  expect(s.candidates.map(c => c.id)).toEqual([a]);
  expect(s.challenger).toBeNull();
  expect(s.isComplete).toBe(true);
});
