import { it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { getBadgesBatch, BADGE_THRESHOLDS } from './badges.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let leagueId: number;
let seasonId: number;
let roundSeq = 0;

function competitor(name: string): number {
  return (db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?) RETURNING id')
    .get('c-' + name, name) as { id: number }).id;
}
function round(): number {
  return upsertRound(db, seasonId, {
    mlRoundId: `r-${++roundSeq}`, name: `Round ${roundSeq}`, description: '',
    spotifyPlaylistUrl: '', createdAt: new Date().toISOString(),
  });
}
function submit(roundId: number, comp: number, uri: string, artists: string): void {
  db.prepare(`INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at)
    VALUES (?,?,?,?,?,?)`).run(roundId, comp, uri, 'T', artists, new Date().toISOString());
}
function vote(roundId: number, voter: number, uri: string, pts: number, comment: string | null = null): void {
  db.prepare(`INSERT INTO votes (round_id, voter_id, spotify_uri, points, comment, created_at)
    VALUES (?,?,?,?,?,?)`).run(roundId, voter, uri, pts, comment, new Date().toISOString());
}

/** Build a round of `n` songs scored n, n-1, …, 1 (song i at index 0 is the winner). */
function rankedRound(uris: string[], artistOf: (i: number) => string): number {
  const r = round();
  const voter = competitor('judge-' + r);
  uris.forEach((uri, i) => {
    const owner = competitor(`o-${r}-${i}`);
    submit(r, owner, uri, artistOf(i));
    vote(r, voter, uri, uris.length - i); // index 0 → highest points
  });
  return r;
}

beforeEach(() => {
  db = openLeagueDb(':memory:');
  seedLeagues(db);
  leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='hip-jammers'").get() as { id: number }).id;
  seasonId = upsertSeason(db, leagueId, 1, 'active');
  roundSeq = 0;
});

it('returns empty badge sets for an unknown song', () => {
  const res = getBadgesBatch(db, [{ uri: 'spotify:track:none', artist: 'Nobody' }]);
  expect(res['spotify:track:none']).toEqual({
    song: { medals: { gold: 0, silver: 0, bronze: 0 }, poop: 0, bigDiscussion: 0 },
    artist: { medals: { gold: 0, silver: 0, bronze: 0 }, poop: 0, bigDiscussion: 0 },
  });
});

it('awards gold/silver/bronze by within-round placement', () => {
  const uris = ['g', 's', 'b', 'd', 'e', 'f', 'last'].map((x) => `spotify:track:${x}`);
  rankedRound(uris, (i) => `Artist${i}`);
  const res = getBadgesBatch(db, uris.map((u, i) => ({ uri: u, artist: `Artist${i}` })));
  expect(res[uris[0]].song.medals).toEqual({ gold: 1, silver: 0, bronze: 0 });
  expect(res[uris[1]].song.medals).toEqual({ gold: 0, silver: 1, bronze: 0 });
  expect(res[uris[2]].song.medals).toEqual({ gold: 0, silver: 0, bronze: 1 });
  expect(res[uris[3]].song.medals).toEqual({ gold: 0, silver: 0, bronze: 0 });
});

it('counts a bottom-2 finish as poop (round ≥ POOP_MIN_ROUND_SIZE)', () => {
  expect(BADGE_THRESHOLDS.POOP_MIN_ROUND_SIZE).toBeLessThanOrEqual(7);
  const uris = ['g', 's', 'b', 'd', 'e', 'secondlast', 'last'].map((x) => `spotify:track:${x}`);
  rankedRound(uris, (i) => `Artist${i}`);
  const res = getBadgesBatch(db, uris.map((u, i) => ({ uri: u, artist: `Artist${i}` })));
  expect(res[uris[6]].song.poop).toBe(1); // last
  expect(res[uris[5]].song.poop).toBe(1); // second-last
  expect(res[uris[4]].song.poop).toBe(0); // third-last → not poop
  expect(res[uris[0]].song.poop).toBe(0); // winner → not poop
});

it('flags big-discussion at the comment threshold', () => {
  const r = round();
  const owner = competitor('owner');
  submit(r, owner, 'spotify:track:chatty', 'Talkers');
  for (let i = 0; i < BADGE_THRESHOLDS.BIG_DISCUSSION_MIN_COMMENTS; i++) {
    const v = competitor('voter' + i);
    vote(r, v, 'spotify:track:chatty', 3, `comment ${i}`);
  }
  const res = getBadgesBatch(db, [{ uri: 'spotify:track:chatty', artist: 'Talkers' }]);
  expect(res['spotify:track:chatty'].song.bigDiscussion).toBe(1);
});

it('aggregates medals at the artist level across rounds and counts repeats', () => {
  // Same artist wins two different rounds with two different songs.
  rankedRound(['win1', 'a', 'b', 'c', 'd', 'e', 'f'].map((x) => `spotify:track:${x}`),
    (i) => (i === 0 ? 'Champ' : `Other${i}`));
  rankedRound(['win2', 'g', 'h', 'i', 'j', 'k', 'l'].map((x) => `spotify:track:${x}`),
    (i) => (i === 0 ? 'Champ' : `Filler${i}`));
  const res = getBadgesBatch(db, [{ uri: 'spotify:track:win1', artist: 'Champ' }]);
  // The exact song only won once; the artist won twice.
  expect(res['spotify:track:win1'].song.medals.gold).toBe(1);
  expect(res['spotify:track:win1'].artist.medals.gold).toBe(2);
});

it('matches artist case-insensitively on the first artist', () => {
  rankedRound(['spotify:track:x', 'a', 'b', 'c', 'd', 'e', 'f'].map((u) => u),
    (i) => (i === 0 ? 'The Beatles, Billy Preston' : `O${i}`));
  const res = getBadgesBatch(db, [{ uri: 'spotify:track:other', artist: 'the beatles' }]);
  expect(res['spotify:track:other'].artist.medals.gold).toBe(1);
});
