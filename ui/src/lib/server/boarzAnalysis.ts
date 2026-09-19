import type Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveMeForRound } from '$lib/guessing/meCompetitor.js';

// Codex-generated Boarz analysis bundle (data/boarz-final-round-analysis/).
// The profiles were built by scripts/boarz-final-round/build_profiles.py and
// are the evidence base for the per-player analysis buttons in the round
// research tab. Everything here is read-only.

export interface MatchedPlayer {
  competitorId: number;
  /** Music League display name (e.g. "Steiny"). */
  competitorName: string;
  playerId: number | null;
  /** Canonical name used by the codex profiles (e.g. "Dave Steingart"). */
  displayName: string;
  /** Full markdown profile text, when a codex profile matched. */
  profileMd: string | null;
}

export interface AnalysisRoster {
  meCompetitorId: number | null;
  mePlayerName: string | null;
  players: MatchedPlayer[];
}

interface ProfileEntry {
  playerId: number;
  name: string;
  md: string;
}

const PROFILES_DIR = () => `${process.env.DATA_DIR ?? 'data'}/boarz-final-round-analysis/profiles`;
const CATALOG_PATH = () =>
  `${process.env.DATA_DIR ?? 'data'}/boarz-final-round-analysis/candidate-song-catalog.json`;

export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

let profileCache: { mtimeMs: number; profiles: ProfileEntry[] } | null = null;

function loadProfiles(): ProfileEntry[] {
  const dir = PROFILES_DIR();
  const mtime = statSync(dir).mtimeMs;
  if (profileCache && profileCache.mtimeMs === mtime) return profileCache.profiles;
  const profiles: ProfileEntry[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      player?: { id?: number; name?: string };
    };
    const id = raw.player?.id;
    const name = raw.player?.name;
    if (typeof id !== 'number' || !name) continue;
    const mdPath = join(dir, f.replace(/\.json$/, '.md'));
    const md = (() => {
      try {
        return readFileSync(mdPath, 'utf8');
      } catch {
        return '';
      }
    })();
    profiles.push({ playerId: id, name, md });
  }
  profileCache = { mtimeMs: mtime, profiles };
  return profiles;
}

export interface CatalogTrack {
  artist: string;
  title: string;
  album: string | null;
  source_release_date: string | null;
  spotify_uri: string;
  spotify_duration_seconds: number | null;
  spotify_album_release_date: string | null;
  spotify_popularity: number | null;
  artist_genres: string[];
  local_metadata: Record<string, unknown> | null;
}

type Catalog = { mtimeMs: number; byUri: Map<string, CatalogTrack> };
let catalogCache: Catalog | null = null;

function loadCatalog(): Catalog {
  const path = CATALOG_PATH();
  const mtime = statSync(path).mtimeMs;
  if (catalogCache && catalogCache.mtimeMs === mtime) return catalogCache;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { tracks?: CatalogTrack[] };
  const byUri = new Map<string, CatalogTrack>();
  for (const t of raw.tracks ?? []) if (t.spotify_uri) byUri.set(t.spotify_uri, t);
  catalogCache = { mtimeMs: mtime, byUri };
  return catalogCache;
}

export function catalogTrack(spotifyUri: string): CatalogTrack | null {
  try {
    return loadCatalog().byUri.get(spotifyUri) ?? null;
  } catch {
    return null;
  }
}

/**
 * League roster for the round's season, matched to codex profiles by
 * competitors.player_id first (display names like "Steiny" do not match the
 * canonical profile names), then by normalized name. "Me" (the owner) is
 * excluded — the analysis covers everyone else.
 */
export function buildAnalysisRoster(db: Database.Database, roundId: number): AnalysisRoster {
  const rows = db
    .prepare(
      `SELECT c.id AS competitor_id, c.name AS competitor_name, c.player_id, p.name AS player_name
         FROM season_standings ss
         JOIN competitors c ON c.id = ss.competitor_id
         LEFT JOIN players p ON p.id = c.player_id
        WHERE ss.season_id = (SELECT season_id FROM rounds WHERE id = ?)
        ORDER BY c.id`,
    )
    .all(roundId) as { competitor_id: number; competitor_name: string; player_id: number | null; player_name: string | null }[];

  const profiles = (() => {
    try {
      return loadProfiles();
    } catch {
      return [];
    }
  })();
  const byPlayerId = new Map(profiles.map((p) => [p.playerId, p]));
  const byNormName = new Map(profiles.map((p) => [normName(p.name), p]));

  const meCompetitorId = resolveMeForRound(db, roundId);
  const mePlayerName =
    rows.find((r) => r.competitor_id === meCompetitorId)?.player_name ??
    byPlayerId.get(1)?.name ?? // codex profile id 1 = Matt Mariani (owner)
    null;

  const seenPlayers = new Set<number>();
  const players: MatchedPlayer[] = [];
  for (const r of rows) {
    if (r.competitor_id === meCompetitorId) continue;
    if (r.player_id !== null) {
      if (seenPlayers.has(r.player_id)) continue; // renamed competitor rows (djensen435 ×2)
      seenPlayers.add(r.player_id);
    }
    const profile = (r.player_id !== null ? byPlayerId.get(r.player_id) : undefined) ??
      byNormName.get(normName(r.player_name ?? r.competitor_name));
    const displayName = r.player_name ?? profile?.name ?? r.competitor_name;
    if (mePlayerName && normName(displayName) === normName(mePlayerName)) continue;
    players.push({
      competitorId: r.competitor_id,
      competitorName: r.competitor_name,
      playerId: r.player_id,
      displayName,
      profileMd: profile?.md || null,
    });
  }
  return { meCompetitorId, mePlayerName, players };
}

/** Metadata block for one candidate song: codex catalog first, DB tables as fallback. */
export function buildSongMetaBlock(db: Database.Database, spotifyUri: string): string {
  const lines: string[] = [];
  const t = catalogTrack(spotifyUri);
  if (t) {
    lines.push(`Title: ${t.title}`);
    lines.push(`Artist: ${t.artist}`);
    if (t.album) lines.push(`Album: ${t.album}`);
    if (t.source_release_date) lines.push(`Source-listed release: ${t.source_release_date}`);
    if (t.spotify_album_release_date) lines.push(`Spotify album release: ${t.spotify_album_release_date}`);
    if (t.spotify_duration_seconds != null)
      lines.push(`Duration: ${Math.round(t.spotify_duration_seconds)}s`);
    if (t.spotify_popularity != null) lines.push(`Spotify popularity: ${t.spotify_popularity}/100`);
    if (t.artist_genres?.length) lines.push(`Artist genres (Spotify, not track genres): ${t.artist_genres.join(', ')}`);
    const local = (t.local_metadata ?? {}) as Record<string, unknown>;
    const tags = typeof local.lastfm_tags_json === 'string' ? local.lastfm_tags_json : null;
    if (tags) lines.push(`Last.fm tags: ${tags}`);
    if (local.bpm != null) lines.push(`BPM: ${local.bpm}`);
    if (local.energy != null) lines.push(`Energy: ${local.energy}`);
    if (local.has_lyrics != null) lines.push(`Has lyrics: ${local.has_lyrics ? 'yes' : 'no (instrumental)'}`);
    if (local.word_count != null) lines.push(`Lyric word count: ${local.word_count}`);
    if (local.listeners != null) lines.push(`Last.fm listeners: ${local.listeners}`);
    if (local.playcount != null) lines.push(`Last.fm playcount: ${local.playcount}`);
  } else {
    const row = db
      .prepare(
        `SELECT p.spotify_popularity, p.listeners, p.tags, a.bpm, a.energy, l.has_lyrics
           FROM song_popularity p
           LEFT JOIN song_audio_features a ON a.spotify_uri = p.spotify_uri
           LEFT JOIN song_lyrics_metrics l ON l.spotify_uri = p.spotify_uri
          WHERE p.spotify_uri = ?`,
      )
      .get(spotifyUri) as
      | { spotify_popularity: number | null; listeners: number | null; tags: string | null; bpm: number | null; energy: number | null; has_lyrics: number | null }
      | undefined;
    if (row) {
      if (row.spotify_popularity != null) lines.push(`Spotify popularity: ${row.spotify_popularity}/100`);
      if (row.listeners != null) lines.push(`Last.fm listeners: ${row.listeners}`);
      if (row.tags) lines.push(`Last.fm tags: ${row.tags}`);
      if (row.bpm != null) lines.push(`BPM: ${row.bpm}`);
      if (row.energy != null) lines.push(`Energy: ${row.energy}`);
      if (row.has_lyrics != null) lines.push(`Has lyrics: ${row.has_lyrics ? 'yes' : 'no (instrumental)'}`);
    }
  }
  if (!lines.length) lines.push('(No verified metadata on file for this track.)');
  return lines.join('\n');
}
