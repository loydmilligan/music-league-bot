import type Database from 'better-sqlite3';

/**
 * Per-round video-playlist configuration.
 *
 * The YTM drop can build a SECOND playlist of the music videos for a round
 * (scripts/ytm-drop/). Whether it does, and where the video links come from, is
 * a per-round decision with a global default — a "post your favourite music
 * video" round wants it, an ordinary round does not.
 *
 * Source precedence follows from the two flags:
 *   comments + search → comments win per submission; search only fills the gaps
 *   comments only     → submissions with no link are left as holes
 *   search only       → every pick is a search result
 *   neither           → nothing to build; reported, not silently coerced
 *
 * IMPORTANT: this contract is implemented TWICE. The drop script runs on the
 * host as plain ESM and cannot import this TypeScript, so it carries its own
 * copy at scripts/ytm-drop/videoConfig.mjs. tests/videoPlaylistContract.test.ts
 * imports both and fails if they ever disagree — change one, change the other.
 */
export interface VideoPlaylistConfig {
  /** Build a video playlist for this round at all. */
  enabled: boolean;
  /** Read YouTube links out of submission comments. */
  useComments: boolean;
  /** Search YouTube for submissions with no usable link. */
  useSearch: boolean;
  /**
   * Confidence (0-100) at or above which a SEARCH result is accepted without
   * review. Below it the pick is excluded from the playlist and listed in the
   * approval report instead. Ignored when useSearch is false.
   */
  searchAutoAcceptPct: number;
}

/**
 * Shipped defaults: off, because most rounds have nothing to do with video.
 * When it is switched on, both sources start enabled — the comment is the
 * submitter's own answer and search only fills what they left empty.
 *
 * 70 is the recommended threshold, and the number the tooltip cites: high
 * enough to reject the covers and fan uploads that search returns for songs
 * with no real music video, low enough to keep an artist- or VEVO-channel
 * upload that isn't explicitly titled "official video".
 */
export const DEFAULT_VIDEO_PLAYLIST_CONFIG: VideoPlaylistConfig = {
  enabled: false,
  useComments: true,
  useSearch: true,
  searchAutoAcceptPct: 70,
};

export const RECOMMENDED_AUTO_ACCEPT_PCT = 70;
export const VIDEO_PLAYLIST_DEFAULTS_KEY = 'video_playlist_defaults';

const asBool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Clamp to an integer 0-100; anything unparseable falls back. */
function asPct(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Coerce anything (a parsed JSON blob, a partial patch, junk) into a complete
 * config, filling gaps from `base`. Never throws: a malformed stored value must
 * degrade to the default rather than break the drop for every league.
 */
export function normalizeVideoPlaylistConfig(
  raw: unknown,
  base: VideoPlaylistConfig = DEFAULT_VIDEO_PLAYLIST_CONFIG,
): VideoPlaylistConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    enabled: asBool(r.enabled, base.enabled),
    useComments: asBool(r.useComments, base.useComments),
    useSearch: asBool(r.useSearch, base.useSearch),
    searchAutoAcceptPct: asPct(r.searchAutoAcceptPct, base.searchAutoAcceptPct),
  };
}

/** Parse a JSON string column, tolerating null/empty/garbage. */
export function parseConfigJson(json: string | null | undefined): unknown {
  if (!json || !json.trim()) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * The config a round actually runs under: global defaults, then the round's
 * own overrides on top. A round with no stored config inherits entirely, so
 * changing the default retroactively changes every uncustomized round.
 */
export function resolveVideoPlaylistConfig(
  roundJson: string | null | undefined,
  defaultsJson: string | null | undefined,
): VideoPlaylistConfig {
  const defaults = normalizeVideoPlaylistConfig(parseConfigJson(defaultsJson));
  const round = parseConfigJson(roundJson);
  return round == null ? defaults : normalizeVideoPlaylistConfig(round, defaults);
}

/** True when the config asks for a playlist but names no source to build it from. */
export function hasNoVideoSource(cfg: VideoPlaylistConfig): boolean {
  return cfg.enabled && !cfg.useComments && !cfg.useSearch;
}

// ── persistence ──────────────────────────────────────────────────────────────

export function getVideoPlaylistDefaults(db: Database.Database): VideoPlaylistConfig {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(VIDEO_PLAYLIST_DEFAULTS_KEY) as
    | { value: string }
    | undefined;
  return normalizeVideoPlaylistConfig(parseConfigJson(row?.value));
}

export function updateVideoPlaylistDefaults(
  db: Database.Database,
  patch: Partial<VideoPlaylistConfig>,
): VideoPlaylistConfig {
  const next = normalizeVideoPlaylistConfig(patch, getVideoPlaylistDefaults(db));
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    VIDEO_PLAYLIST_DEFAULTS_KEY,
    JSON.stringify(next),
  );
  return next;
}

/** The round's stored overrides, or null when it inherits the defaults. */
export function getRoundVideoPlaylistOverride(
  db: Database.Database,
  roundId: number,
): VideoPlaylistConfig | null {
  const row = db.prepare('SELECT video_playlist_config AS c FROM rounds WHERE id = ?').get(roundId) as
    | { c: string | null }
    | undefined;
  const parsed = parseConfigJson(row?.c);
  return parsed == null ? null : normalizeVideoPlaylistConfig(parsed, getVideoPlaylistDefaults(db));
}

/** The config this round runs under, defaults included. */
export function getRoundVideoPlaylistConfig(db: Database.Database, roundId: number): VideoPlaylistConfig {
  return getRoundVideoPlaylistOverride(db, roundId) ?? getVideoPlaylistDefaults(db);
}

/**
 * Store (or clear) a round's overrides. Passing null resets the round to
 * "inherit the defaults", which is not the same as storing a copy of today's
 * defaults — the inheriting round follows future changes.
 */
export function setRoundVideoPlaylistConfig(
  db: Database.Database,
  roundId: number,
  patch: Partial<VideoPlaylistConfig> | null,
): VideoPlaylistConfig | null {
  if (patch === null) {
    db.prepare('UPDATE rounds SET video_playlist_config = NULL WHERE id = ?').run(roundId);
    return null;
  }
  const next = normalizeVideoPlaylistConfig(patch, getRoundVideoPlaylistConfig(db, roundId));
  db.prepare('UPDATE rounds SET video_playlist_config = ? WHERE id = ?').run(JSON.stringify(next), roundId);
  return next;
}
