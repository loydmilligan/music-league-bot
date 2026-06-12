import { it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues } from '../db/leagues.js';
import { parseZip } from './zipParser.js';
import { importZipData, importLiveRoundsData } from './importer.js';
import type { ParsedZip } from './zipParser.js';

const mk = () => { const db = openLeagueDb(':memory:'); seedLeagues(db); return db; };

function fixture(rel: string): string | null {
  for (const base of ['../data', '../../data']) {
    const p = resolve(base, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

const hj = fixture('hip-jammers/season-1/export.zip');
const np = fixture('nostalgia-pit/season-1/export.zip');

function parsedZip(roundIds: string[], voteRoundIds: string[]): ParsedZip {
  const competitors = [
    { id: 'c1', name: 'Alice' },
    { id: 'c2', name: 'Bob' },
  ];
  return {
    competitors,
    rounds: roundIds.map((id, i) => ({
      id,
      createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      name: `Round ${i + 1}`,
      description: `Theme ${i + 1}`,
      playlistUrl: '',
    })),
    submissions: roundIds.map((roundId, i) => ({
      spotifyUri: `spotify:track:${roundId}`,
      title: `Song ${i + 1}`,
      album: '',
      artists: 'Artist',
      submitterId: 'c1',
      createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T01:00:00Z`,
      comment: '',
      roundId,
      visibleToVoters: voteRoundIds.includes(roundId),
    })),
    votes: voteRoundIds.map((roundId, i) => ({
      spotifyUri: `spotify:track:${roundId}`,
      voterId: 'c2',
      createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T02:00:00Z`,
      points: 5,
      comment: '',
      roundId,
    })),
  };
}

(hj ? it : it.skip)('imports HJ S1 with rounds+submissions+votes', () => {
  const db = mk();
  const r = importZipData(db, 'hip-jammers', 1, parseZip(readFileSync(hj!)));
  expect(r.status).toBe('success');
  expect(r.roundsCount).toBeGreaterThan(0);
  expect(r.votesCount).toBeGreaterThan(0);
});

(hj ? it : it.skip)('idempotent', () => {
  const db = mk();
  const buf = readFileSync(hj!);
  importZipData(db, 'hip-jammers', 1, parseZip(buf));
  expect(importZipData(db, 'hip-jammers', 1, parseZip(buf)).status).toBe('success');
});

(np ? it : it.skip)('handles empty in-progress ZIP', () => {
  const db = mk();
  const r = importZipData(db, 'nostalgia-pit', 1, parseZip(readFileSync(np!)));
  expect(r.status).toBe('success');
});

it('keeps a re-imported active season active even when historical rounds have votes', () => {
  const db = mk();
  importZipData(db, 'second-best', 1, parsedZip(['r1', 'r2'], ['r1']));

  let season = db.prepare(
    `SELECT status FROM seasons s JOIN leagues l ON l.id = s.league_id
     WHERE l.slug = 'second-best' AND s.season_number = 1`,
  ).get() as { status: string };
  expect(season.status).toBe('active');

  importZipData(db, 'second-best', 1, parsedZip(['r1', 'r2', 'r3'], ['r1', 'r2']));
  season = db.prepare(
    `SELECT status FROM seasons s JOIN leagues l ON l.id = s.league_id
     WHERE l.slug = 'second-best' AND s.season_number = 1`,
  ).get() as { status: string };

  expect(season.status).toBe('active');
  const roundCount = db.prepare(
    `SELECT COUNT(*) AS n FROM rounds r
     JOIN seasons s ON s.id = r.season_id
     JOIN leagues l ON l.id = s.league_id
     WHERE l.slug = 'second-best' AND s.season_number = 1`,
  ).get() as { n: number };
  expect(roundCount.n).toBe(3);
});

it('imports live round metadata and re-activates a stale season when a live round exists', () => {
  const db = mk();
  const result = importLiveRoundsData(db, 'hip-jammers', 3, [
    {
      id: 'ml-round-107',
      number: 107,
      name: 'Live Round 107',
      description: 'Live theme',
      playlistUrl: 'https://open.spotify.com/playlist/live-107',
      submissionsDueUtc: '2099-01-01T00:00:00Z',
      votesDueUtc: '2099-01-08T00:00:00Z',
    },
    {
      id: 'ml-round-108',
      number: 108,
      name: 'Live Round 108',
      description: 'Future theme',
      playlistUrl: null,
      submissionsDueUtc: '2099-02-01T00:00:00Z',
      votesDueUtc: '2099-02-08T00:00:00Z',
    },
  ]);

  expect(result.status).toBe('success');
  expect(result.roundsCount).toBe(2);

  const season = db.prepare(
    `SELECT status FROM seasons s JOIN leagues l ON l.id = s.league_id
     WHERE l.slug = 'hip-jammers' AND s.season_number = 3`,
  ).get() as { status: string };
  expect(season.status).toBe('active');
});
