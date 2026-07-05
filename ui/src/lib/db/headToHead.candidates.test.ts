import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { addResearchSong, updateResearchSong } from './research.js';
import { getH2HCandidates } from './headToHead.js';
import type Database from 'better-sqlite3';

function mkRound(db: Database.Database, mlRoundId = 'h2h-candidates-test'): number {
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 99, 'active');
  return upsertRound(db, seasonId, {
    mlRoundId, name: 'H2H test', description: '', spotifyPlaylistUrl: '',
    createdAt: new Date().toISOString(),
  });
}

let db: Database.Database;
beforeEach(() => { db = openLeagueDb(':memory:'); });

it('returns eligible candidates sorted by weighted score desc', () => {
  const roundId = mkRound(db);
  // Five songs with varying ratings. Defaults: discovery 35, theme 25,
  // personal 25, nostalgia 15. Compute expected scores to sanity-check.
  const songs = [
    { uri: 'a', theme: 5, disc: 5, nos: 5, pers: 5 }, // 5.0
    { uri: 'b', theme: 3, disc: 4, nos: 2, pers: 4 }, // 3.45
    { uri: 'c', theme: 1, disc: 1, nos: 1, pers: 1 }, // 1.0
    { uri: 'd', theme: 4, disc: 3, nos: 4, pers: 5 }, // 3.9
    { uri: 'e', theme: 2, disc: 5, nos: 3, pers: 3 }, // 3.45 (tie with b)
  ];
  for (const s of songs) {
    const row = addResearchSong(db, { roundId, spotifyUri: `spotify:track:${s.uri}`, title: s.uri.toUpperCase(), artist: 'X', album: null });
    updateResearchSong(db, row.id, {
      themeFit: s.theme, discoveryPotential: s.disc, nostalgiaPotential: s.nos, personalRating: s.pers,
    });
  }
  const got = getH2HCandidates(db, roundId);
  expect(got.length).toBe(5);
  expect(got[0].spotifyUri).toBe('spotify:track:a');
  expect(got[got.length - 1].spotifyUri).toBe('spotify:track:c');
  // monotonically non-increasing
  for (let i = 1; i < got.length; i++) {
    expect(got[i].weightedScore!).toBeLessThanOrEqual(got[i - 1].weightedScore!);
  }
});

it('excludes songs whose status is not the eligible reviewing default', () => {
  const roundId = mkRound(db);
  const a = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:keep', title: 'K', artist: 'X', album: null });
  const b = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:drop', title: 'D', artist: 'X', album: null });
  updateResearchSong(db, a.id, { themeFit: 4 });
  updateResearchSong(db, b.id, { themeFit: 5 });
  db.prepare("UPDATE research_songs SET status='retired' WHERE id=?").run(b.id);
  const got = getH2HCandidates(db, roundId);
  expect(got.map(c => c.spotifyUri)).toEqual(['spotify:track:keep']);
});

it('handles songs with no ratings (weightedScore null sorts to the bottom)', () => {
  const roundId = mkRound(db);
  const rated = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:rated', title: 'R', artist: 'X', album: null });
  addResearchSong(db, { roundId, spotifyUri: 'spotify:track:unrated', title: 'U', artist: 'X', album: null });
  updateResearchSong(db, rated.id, { themeFit: 3 });
  const got = getH2HCandidates(db, roundId);
  expect(got[0].spotifyUri).toBe('spotify:track:rated');
  expect(got[1].weightedScore).toBeNull();
});

it('scopes results to the requested round', () => {
  const roundA = mkRound(db, 'round-a');
  const roundB = mkRound(db, 'round-b');
  addResearchSong(db, { roundId: roundA, spotifyUri: 'spotify:track:aaa', title: 'A', artist: 'A', album: null });
  addResearchSong(db, { roundId: roundB, spotifyUri: 'spotify:track:bbb', title: 'B', artist: 'B', album: null });
  expect(getH2HCandidates(db, roundA).map(c => c.spotifyUri)).toEqual(['spotify:track:aaa']);
  expect(getH2HCandidates(db, roundB).map(c => c.spotifyUri)).toEqual(['spotify:track:bbb']);
});

it('weightedScore is computed from quality/replayability (Unicard), not personal/nostalgia (legacy)', () => {
  const roundId = mkRound(db, 'unicard-scoring-test');
  const row = addResearchSong(db, { roundId, spotifyUri: 'spotify:track:unicard', title: 'U', artist: 'X', album: null });
  updateResearchSong(db, row.id, {
    themeFit: 5, discoveryPotential: 5, quality: 5, replayability: 5,
    // Explicitly no personalRating/nostalgiaPotential — under the legacy
    // formula (computeScore) this song would score null since neither of
    // its two required dims (personal/nostalgia) has a value.
  });
  const candidates = getH2HCandidates(db, roundId);
  const scored = candidates.find(c => c.spotifyUri === 'spotify:track:unicard')!;
  expect(scored.weightedScore).not.toBeNull();
  expect(scored.weightedScore).toBe(20); // max score: all 4 Unicard dims rated 5/5
});
