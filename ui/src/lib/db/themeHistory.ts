import type Database from 'better-sqlite3';
import { getBucketBoundaries, type BucketBoundaries } from './settings.js';

// Theme-history service (sprint-24, theme-data) — powers Tab 2 "Theme research".
// For every past round/theme across all seasons it returns the songs submitted
// under that theme, each with its submitter and the points it scored.
//
// In this corpus a round IS a theme: `rounds.description` holds the theme prompt
// (e.g. "Songs with weather-related lyrics") and `rounds.name` is the short round
// title (e.g. "Weatherbug"). We surface the prompt as `theme` and the title as
// `round` so the frontend gets both the scannable headline and a label. Joins
// mirror songHistory.ts / research.ts: rounds→seasons→leagues, and a submission's
// points = SUM(votes.points) for that round+uri.
//
// sprint-25 (song-metadata display): each pick now also carries the per-song
// enrichment the pick-row shows inline/expanded — obscurity + bucket, energy,
// lyrics, tempo, duration, album art, and genre tags — LEFT-joined by spotify_uri
// off song_popularity / song_audio_features / song_lyrics_metrics. All are
// nullable: completed rounds are ~fully covered, fresh/in-progress picks are not.

export interface ThemePick {
  title: string;
  artist: string;
  submitter: string;
  /** SUM(votes.points); null when the round hasn't been voted yet (fresh/pending). */
  points: number | null;
  albumArtUrl: string | null;
  popularityProxy: number | null; // 0–100
  obscurity: number | null; // 100 − popularityProxy
  obscurityBucket: string | null; // "Radio Hit" | "Recognizable" | "Curious Cut" | "Rabbit Hole"
  energy: number | null; // 0–100 (already scaled)
  hasLyrics: boolean | null; // true=on file, false=instrumental, null=not analyzed
  bpm: number | null;
  musicalKey: string | null;
  scale: string | null; // "major" | "minor"
  durationS: number | null;
  tags: string[]; // top Last.fm genre tags ([] when none/unanalyzed)
}

const BUCKET_LABELS = ['Radio Hit', 'Recognizable', 'Curious Cut', 'Rabbit Hole'] as const;

/** Human bucket label for a raw obscurity, using the configured boundaries. */
function bucketLabel(obscurity: number, b: BucketBoundaries): string {
  const i = obscurity < b.b1 ? 0 : obscurity < b.b2 ? 1 : obscurity < b.b3 ? 2 : 3;
  return BUCKET_LABELS[i];
}

/** Parse the song_popularity.tags JSON array; tolerate null/garbage. */
function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export interface ThemeHistory {
  theme: string;
  season: number;
  round: string;
  picks: ThemePick[];
}

/**
 * Strip the trailing "Theme provided by: …" attribution (and surrounding blank
 * lines) the importer leaves on round descriptions, so the prompt reads clean.
 */
function cleanPrompt(description: string | null): string {
  if (!description) return '';
  return description.replace(/\s*Theme provided by:.*$/is, '').trim();
}

/**
 * Every theme/round across all seasons with the songs submitted under it.
 * Themes are ordered season→round (created_at); picks within a theme are
 * ordered highest-points first.
 */
export function getThemeHistory(db: Database.Database): ThemeHistory[] {
  const rounds = db
    .prepare(
      `SELECT r.id AS round_id, r.name AS round, r.description AS description,
              s.season_number AS season
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       ORDER BY s.season_number, r.created_at, r.id`,
    )
    .all() as { round_id: number; round: string; description: string | null; season: number }[];

  if (!rounds.length) return [];

  // All picks in one pass: a submission's points = SUM(votes.points) for its
  // round+uri (the league-wide convention used by songHistory.ts). Per-song
  // enrichment is LEFT-joined by spotify_uri (1:1 tables, safe under GROUP BY m.id).
  const picks = db
    .prepare(
      `SELECT m.round_id AS round_id, m.title AS title, m.artists AS artist,
              COALESCE(c.name, 'Unknown') AS submitter,
              COALESCE(SUM(v.points), 0) AS points,
              m.album_art_url AS albumArtUrl,
              sp.popularity_proxy AS popularityProxy,
              sp.tags AS tagsJson,
              af.bpm AS bpm, af.key AS musicalKey, af.scale AS scale,
              af.energy AS energy, af.duration_s AS durationS,
              lm.has_lyrics AS hasLyrics
       FROM ml_submissions m
       LEFT JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       LEFT JOIN song_popularity sp ON sp.spotify_uri = m.spotify_uri
       LEFT JOIN song_audio_features af ON af.spotify_uri = m.spotify_uri
       LEFT JOIN song_lyrics_metrics lm ON lm.spotify_uri = m.spotify_uri
       GROUP BY m.id
       ORDER BY points DESC, m.title`,
    )
    .all() as {
    round_id: number;
    title: string;
    artist: string;
    submitter: string;
    points: number;
    albumArtUrl: string | null;
    popularityProxy: number | null;
    tagsJson: string | null;
    bpm: number | null;
    musicalKey: string | null;
    scale: string | null;
    energy: number | null;
    durationS: number | null;
    hasLyrics: number | null;
  }[];

  // Rounds with any vote at all → distinguishes "scored 0" from "not voted yet".
  const votedRounds = new Set<number>(
    (db.prepare('SELECT DISTINCT round_id FROM votes').all() as { round_id: number }[]).map((r) => r.round_id),
  );
  const boundaries = getBucketBoundaries(db);

  const byRound = new Map<number, ThemePick[]>();
  for (const p of picks) {
    const popularityProxy = p.popularityProxy === null ? null : Number(p.popularityProxy);
    const obscurity = popularityProxy === null ? null : 100 - popularityProxy;
    const list = byRound.get(p.round_id) ?? [];
    list.push({
      title: p.title,
      artist: p.artist,
      submitter: p.submitter,
      points: votedRounds.has(p.round_id) ? Number(p.points) : null,
      albumArtUrl: p.albumArtUrl ?? null,
      popularityProxy,
      obscurity,
      obscurityBucket: obscurity === null ? null : bucketLabel(obscurity, boundaries),
      energy: p.energy === null ? null : Math.round(Number(p.energy)),
      hasLyrics: p.hasLyrics === null ? null : Boolean(p.hasLyrics),
      bpm: p.bpm === null ? null : Number(p.bpm),
      musicalKey: p.musicalKey ?? null,
      scale: p.scale ?? null,
      durationS: p.durationS === null ? null : Number(p.durationS),
      tags: parseTags(p.tagsJson),
    });
    byRound.set(p.round_id, list);
  }

  return rounds.map((r) => ({
    theme: cleanPrompt(r.description) || r.round,
    season: Number(r.season),
    round: r.round,
    picks: byRound.get(r.round_id) ?? [],
  }));
}
