import type Database from 'better-sqlite3';

// sprint-18 Tastemaker (discoverability v2 / Concept C). Per-player season taste
// profile: 4 raw-obscurity buckets + a MEDIAN-percentile "tastemaker score".
//
// Scoring (all computed SERVER-SIDE — the percentile/median got dropped twice in
// mockups when only raw obscurity was shipped):
//   per-song obscurity         = 100 − popularity_proxy (Last.fm, stored)
//   per-song discoveryPercentile = rank of obscurity across the corpus's scored
//                                  songs, 0-100 (de-squashes the bunched scale)
//   per-player tastemakerScore = MEDIAN of their songs' percentiles (median so a
//                                single mainstream pick can't tank a maven)
//   buckets (raw obscurity):   Radio Hit <10 / Recognizable 10-19 / Curious Cut
//                              20-29 / Rabbit Hole 30+
//
// Corpus = the season's rounds cumulative through the digest's round (r.id ≤
// current). rank = ranking over that corpus; prevRank = the same ranking over the
// corpus through the PRIOR round (r.id < current) — the round-over-round ▲/▼
// source, recomputed (no extra storage), mirroring the standings model.

export type Bucket = 'radioHit' | 'recognizable' | 'curiousCut' | 'rabbitHole';

export interface TastemakerSong {
  round: string;
  artist: string;
  title: string;
  obscurity: number | null;
  discoveryPercentile: number | null;
  bucket: Bucket | null;
  points: number;
}

export interface TastemakerPlayer {
  name: string;
  rank: number;
  prevRank: number | null;
  tastemakerScore: number; // median of this player's songs' discoveryPercentile
  avgPoints: number;
  submissionCount: number;
  buckets: { radioHit: number; recognizable: number; curiousCut: number; rabbitHole: number };
  songs: TastemakerSong[]; // most-obscure-first
}

export interface TastemakerPayload {
  scope: 'season';
  season: string;
  players: TastemakerPlayer[];
}

// Minimum fraction of the corpus's real submissions that must have popularity
// data before we render (sprint-17). Below this the data is incomplete → suppress.
export const COVERAGE_THRESHOLD = 0.8;

const firstArtist = (a: string): string => (String(a ?? '').split(',')[0] ?? '').trim();
const bucketOf = (o: number): Bucket => (o < 10 ? 'radioHit' : o < 20 ? 'recognizable' : o < 30 ? 'curiousCut' : 'rabbitHole');

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Map each distinct obscurity value → its 0-100 percentile rank across the corpus (average rank for ties). */
function percentileByObscurity(obscs: number[]): Map<number, number> {
  const sorted = [...obscs].sort((a, b) => a - b);
  const N = sorted.length;
  const map = new Map<number, number>();
  let i = 0;
  while (i < N) {
    let j = i;
    while (j + 1 < N && sorted[j + 1] === sorted[i]) j++;
    const avgRank = (i + 1 + (j + 1)) / 2; // 1-based
    map.set(sorted[i], N > 1 ? Math.round(((avgRank - 1) / (N - 1)) * 100) : 50);
    i = j + 1;
  }
  return map;
}

interface RawSong { player: string; roundId: number; artists: string; title: string; proxy: number | null; points: number }

function corpusSongs(db: Database.Database, seasonId: number, roundId: number, inclusive: boolean): RawSong[] {
  const cmp = inclusive ? '<=' : '<';
  return db
    .prepare(
      `SELECT c.name AS player, m.round_id AS roundId, m.artists AS artists, m.title AS title,
              sp.popularity_proxy AS proxy,
              (SELECT COALESCE(SUM(v.points), 0) FROM votes v
                 WHERE v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri) AS points
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
       WHERE r.season_id = ? AND r.id ${cmp} ? AND m.competitor_id IS NOT NULL
         AND m.spotify_uri LIKE 'spotify:track:%'`,
    )
    .all(seasonId, roundId) as RawSong[];
}

interface Built { name: string; tastemakerScore: number; avgPoints: number; submissionCount: number; buckets: TastemakerPlayer['buckets']; songs: TastemakerSong[] }

/** Build per-player detail (no rank) from a corpus of songs. Only players with ≥1 scored song. */
function buildPlayers(songs: RawSong[], roundLabel: Map<number, string>): Built[] {
  const scoredObsc = songs.filter((s) => s.proxy != null).map((s) => 100 - (s.proxy as number));
  const pmap = percentileByObscurity(scoredObsc);

  const byName = new Map<string, { songs: TastemakerSong[]; pct: number[]; points: number[]; buckets: TastemakerPlayer['buckets'] }>();
  for (const s of songs) {
    const obsc = s.proxy != null ? 100 - s.proxy : null;
    const pct = obsc != null ? pmap.get(obsc)! : null;
    const bucket = obsc != null ? bucketOf(obsc) : null;
    const e = byName.get(s.player) ?? { songs: [], pct: [], points: [], buckets: { radioHit: 0, recognizable: 0, curiousCut: 0, rabbitHole: 0 } };
    e.songs.push({ round: roundLabel.get(s.roundId) ?? '', artist: firstArtist(s.artists), title: s.title, obscurity: obsc, discoveryPercentile: pct, bucket, points: s.points });
    e.points.push(s.points);
    if (obsc != null) { e.pct.push(pct!); e.buckets[bucket!] += 1; }
    byName.set(s.player, e);
  }

  const out: Built[] = [];
  for (const [name, e] of byName) {
    if (!e.pct.length) continue; // no scored songs → unrankable
    e.songs.sort((a, b) => (b.obscurity ?? -1) - (a.obscurity ?? -1)); // most-obscure-first
    out.push({
      name,
      tastemakerScore: median(e.pct),
      avgPoints: Math.round((e.points.reduce((a, b) => a + b, 0) / e.points.length) * 10) / 10,
      submissionCount: e.songs.length,
      buckets: e.buckets,
      songs: e.songs,
    });
  }
  return out;
}

/** Rank Built[] by tastemakerScore desc (tie → name) → Map<name, rank> (1-based). */
function rankMap(players: Built[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.tastemakerScore - a.tastemakerScore || a.name.localeCompare(b.name));
  const m = new Map<string, number>();
  sorted.forEach((p, i) => m.set(p.name, i + 1));
  return m;
}

/**
 * Tastemaker v2 payload for the round's season (cumulative through this round),
 * or null when popularity coverage is absent/partial (< COVERAGE_THRESHOLD).
 */
export function getDiscoverability(db: Database.Database, roundId: number): TastemakerPayload | null {
  const round = db.prepare('SELECT id, season_id FROM rounds WHERE id = ?').get(roundId) as { id: number; season_id: number } | undefined;
  if (!round) return null;

  // Coverage gate over the corpus (rounds ≤ current).
  const cov = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN sp.popularity_proxy IS NOT NULL THEN 1 ELSE 0 END) AS covered
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       LEFT JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
       WHERE r.season_id = ? AND r.id <= ? AND m.competitor_id IS NOT NULL AND m.spotify_uri LIKE 'spotify:track:%'`,
    )
    .get(round.season_id, roundId) as { total: number; covered: number };
  if (!cov.total || cov.covered / cov.total < COVERAGE_THRESHOLD) return null;

  // Round labels (theme name, or "Round N" fallback) for songs[].
  const seasonRounds = db.prepare('SELECT id, name FROM rounds WHERE season_id = ? ORDER BY id').all(round.season_id) as { id: number; name: string | null }[];
  const roundLabel = new Map<number, string>();
  seasonRounds.forEach((r, i) => roundLabel.set(r.id, r.name?.trim() || `Round ${i + 1}`));

  const meta = db
    .prepare(`SELECT l.name AS league, s.season_number AS sn FROM seasons s JOIN leagues l ON l.id = s.league_id WHERE s.id = ?`)
    .get(round.season_id) as { league: string; sn: number };

  const current = buildPlayers(corpusSongs(db, round.season_id, roundId, true), roundLabel);
  if (!current.length) return null;

  const curRank = rankMap(current);
  const prevRank = rankMap(buildPlayers(corpusSongs(db, round.season_id, roundId, false), roundLabel));

  const players: TastemakerPlayer[] = current
    .map((p) => ({
      name: p.name,
      rank: curRank.get(p.name)!,
      prevRank: prevRank.get(p.name) ?? null,
      tastemakerScore: p.tastemakerScore,
      avgPoints: p.avgPoints,
      submissionCount: p.submissionCount,
      buckets: p.buckets,
      songs: p.songs,
    }))
    .sort((a, b) => a.rank - b.rank);

  return { scope: 'season', season: `${meta.league} S${meta.sn}`, players };
}
