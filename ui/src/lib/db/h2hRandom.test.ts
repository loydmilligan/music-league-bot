import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { addResearchSong } from './research.js';
import {
  getActiveResearchSongs, getPendingMatchup, startRandomMatchup,
  reshuffleRandomMatchup, selectH2HWinner,
} from './h2hRandom.js';

let db: Database.Database;
let roundId: number;

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundId = upsertRound(db, seasonId, {
    mlRoundId: 'h2h-random-test', name: 'Test Round', description: '',
    spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z',
  });
  for (const letter of ['A', 'B', 'C', 'D']) {
    addResearchSong(db, { roundId, spotifyUri: `spotify:track:${letter}`, title: letter, artist: `Artist ${letter}`, album: null });
  }
});

it('startRandomMatchup picks 2 distinct active songs and persists them', () => {
  const matchup = startRandomMatchup(db, roundId);
  expect(matchup.songAId).not.toBe(matchup.songBId);

  const pending = getPendingMatchup(db, roundId);
  expect(pending).toEqual(matchup);
});

it('startRandomMatchup returns an error result when fewer than 2 active songs exist', () => {
  // Remove 3 of the 4 seeded songs, leaving only 1 active.
  const all = getActiveResearchSongs(db, roundId);
  for (const s of all.slice(1)) {
    db.prepare('UPDATE research_songs SET removed_reason=?, removed_at=? WHERE id=?')
      .run('user_removed', '2026-01-02T00:00:00Z', s.id);
  }
  expect(() => startRandomMatchup(db, roundId)).toThrow(/not enough active songs/i);
});

it('reshuffleRandomMatchup excludes the currently-pending pair', () => {
  const first = startRandomMatchup(db, roundId);
  const reshuffled = reshuffleRandomMatchup(db, roundId);
  expect(reshuffled.songAId).not.toBe(first.songAId);
  expect(reshuffled.songAId).not.toBe(first.songBId);
  expect(reshuffled.songBId).not.toBe(first.songAId);
  expect(reshuffled.songBId).not.toBe(first.songBId);
});

it('selectH2HWinner records the match, soft-removes the loser with a reason, and advances a new challenger', () => {
  const matchup = startRandomMatchup(db, roundId);
  const result = selectH2HWinner(db, roundId, matchup.songAId);

  const match = db.prepare('SELECT * FROM head_to_head_matches WHERE round_id=?').get(roundId) as any;
  expect(match.winner_id).toBe(matchup.songAId);
  expect(match.loser_id).toBe(matchup.songBId);

  const loserRow = db.prepare('SELECT removed_reason, removed_by_song_id FROM research_songs WHERE id=?').get(matchup.songBId) as any;
  expect(loserRow.removed_reason).toBe('h2h_loss');
  expect(loserRow.removed_by_song_id).toBe(matchup.songAId);

  expect(result.songAId).toBe(matchup.songAId); // winner stays in slot A
  expect(result.songBId).not.toBe(matchup.songBId); // new challenger, not the old loser
  expect([matchup.songAId, matchup.songBId]).not.toContain(result.songBId);
});

it('selectH2HWinner throws if winnerSongId is not one of the pending pair', () => {
  startRandomMatchup(db, roundId);
  const bogusId = 999999;
  expect(() => selectH2HWinner(db, roundId, bogusId)).toThrow(/not part of the current matchup/i);
});

it('selectH2HWinner returns a completed matchup (songBId null) when no challengers remain', () => {
  // Reduce to exactly 2 active songs so there's no one left to challenge the winner.
  const all = getActiveResearchSongs(db, roundId);
  for (const s of all.slice(2)) {
    db.prepare('UPDATE research_songs SET removed_reason=?, removed_at=? WHERE id=?')
      .run('user_removed', '2026-01-02T00:00:00Z', s.id);
  }
  const matchup = startRandomMatchup(db, roundId);
  const result = selectH2HWinner(db, roundId, matchup.songAId);
  expect(result.songBId).toBeNull();
  expect(getPendingMatchup(db, roundId)).toBeNull();
});
