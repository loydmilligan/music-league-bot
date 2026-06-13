import type Database from 'better-sqlite3';
import { getPlayer } from '../db/playerHistory.js';

// ── PlayerContext — the structured input consumed by every PredictionTask ────
//
// Built once per task run; passed verbatim to the prompt template.
// Token-bounded: caps on submissions/votes/overlap entries prevent runaway
// context for long-tenured players.  boundingApplied signals to the caller
// (and logged input_json) that the history was trimmed.
//
// Identity is keyed on stable player_id (not competitor name) so renames and
// cross-league competitors map to the same context.

/** One song submitted by this player in a past round. */
export interface SubmissionEntry {
  round: string;        // theme/round name (e.g. "90s Hip-Hop")
  title: string;
  artist: string;
  pointsReceived: number;
}

/** One non-zero vote this player cast in a past round. */
export interface VoteEntry {
  round: string;
  songTitle: string;
  songArtist: string;
  pointsGiven: number;
  comment: string | null;
}

/** Pairwise taste similarity with another player (Jaccard co-voting). */
export interface TasteOverlapEntry {
  playerName: string;
  jaccardScore: number; // 0..1
}

/**
 * Dossier: owner-authored layer + latest AI taste fingerprint.
 * Manual fields (notes, tags) and AI field (tasteFingerprint) are kept separate
 * per the sprint-28 manual/auto separation principle.
 */
export interface PlayerDossier {
  notes: string | null;
  tags: string[];        // parsed from player_profiles.tags JSON array
  tasteFingerprint: unknown | null; // parsed JSON from player_profiles.taste_fingerprint
}

/**
 * Structured, token-bounded player context — the canonical input for all
 * PredictionTask instances in the harness.
 *
 * - submissions: most-recent-first, capped to maxSubmissions
 * - votesCast:   most-recent-first, capped to maxVotes (only points > 0)
 * - tasteOverlap: top entries by Jaccard score, capped to maxTasteOverlapEntries
 * - boundingApplied: true when any cap was hit; caller can include this in logs
 */
export interface PlayerContext {
  playerId: number;
  playerName: string;
  dossier: PlayerDossier;
  submissions: SubmissionEntry[];
  votesCast: VoteEntry[];
  tasteOverlap: TasteOverlapEntry[];
  winRate: number;
  boundingApplied: boolean;
}

export interface BuildContextOpts {
  /** Max submission entries to include. Default: 40. */
  maxSubmissions?: number;
  /** Max voted-song entries to include (only non-zero votes). Default: 60. */
  maxVotes?: number;
  /** Max taste-overlap peers to include. Default: 10. */
  maxTasteOverlapEntries?: number;
}

const DEFAULTS = {
  maxSubmissions: 40,
  maxVotes: 60,
  maxTasteOverlapEntries: 10,
} as const;

/**
 * Assemble a token-bounded PlayerContext for the given player_id.
 *
 * Reuses getPlayer() from playerHistory.ts for submissions, win rate, and
 * taste-overlap data.  Votes cast and dossier come from separate queries
 * (player_profiles table; votes joined via competitors.player_id).
 *
 * Safe for players with no profile row and/or no gameplay history — returns
 * empty arrays and null dossier fields in that case.
 */
export function buildPlayerContext(
  db: Database.Database,
  playerId: number,
  opts: BuildContextOpts = {},
): PlayerContext {
  const maxSubs = opts.maxSubmissions ?? DEFAULTS.maxSubmissions;
  const maxVotes = opts.maxVotes ?? DEFAULTS.maxVotes;
  const maxOverlap = opts.maxTasteOverlapEntries ?? DEFAULTS.maxTasteOverlapEntries;

  // ── Player name ────────────────────────────────────────────────────────────
  const playerRow = db.prepare('SELECT name FROM players WHERE id = ?').get(playerId) as
    | { name: string }
    | undefined;
  const playerName = playerRow?.name ?? `player:${playerId}`;

  // ── Dossier (player_profiles row, may not exist) ──────────────────────────
  const profileRow = db
    .prepare('SELECT notes, tags, taste_fingerprint FROM player_profiles WHERE player_id = ?')
    .get(playerId) as
    | { notes: string | null; tags: string; taste_fingerprint: string | null }
    | undefined;

  let tags: string[] = [];
  if (profileRow?.tags) {
    try {
      tags = JSON.parse(profileRow.tags);
    } catch {
      tags = [];
    }
  }
  let tasteFingerprint: unknown | null = null;
  if (profileRow?.taste_fingerprint) {
    try {
      tasteFingerprint = JSON.parse(profileRow.taste_fingerprint);
    } catch {
      tasteFingerprint = null;
    }
  }

  const dossier: PlayerDossier = {
    notes: profileRow?.notes ?? null,
    tags,
    tasteFingerprint,
  };

  // ── Submissions + win rate + taste overlap (reuse getPlayer) ──────────────
  // getPlayer returns songs oldest-first; reverse for recency before capping.
  const detail = getPlayer(db, playerName);
  const allSubs = [...detail.songs].reverse();
  const boundedSubs = allSubs.length > maxSubs;
  const submissions: SubmissionEntry[] = allSubs.slice(0, maxSubs).map((s) => ({
    round: s.round,
    title: s.title,
    artist: s.artist,
    pointsReceived: s.points,
  }));

  // Taste overlap: sort descending by jaccard, cap to maxOverlap
  const tasteOverlap: TasteOverlapEntry[] = Object.entries(detail.tasteOverlap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxOverlap)
    .map(([name, score]) => ({ playerName: name, jaccardScore: score }));

  // ── Votes cast — fetch via competitor IDs linked to this player_id ─────────
  // Fetch one extra row so we can detect whether the full set was trimmed.
  const competitorIds = (
    db.prepare('SELECT id FROM competitors WHERE player_id = ?').all(playerId) as { id: number }[]
  ).map((r) => r.id);

  let votesCast: VoteEntry[] = [];
  let boundedVotes = false;
  if (competitorIds.length) {
    const ph = competitorIds.map(() => '?').join(',');
    const rawVotes = db
      .prepare(
        `SELECT r.name AS round, m.title AS song_title, m.artists AS song_artist,
                v.points, v.comment
         FROM votes v
         JOIN ml_submissions m ON m.round_id = v.round_id AND m.spotify_uri = v.spotify_uri
         JOIN rounds r ON r.id = v.round_id
         WHERE v.voter_id IN (${ph}) AND v.points > 0
         ORDER BY r.id DESC
         LIMIT ?`,
      )
      .all(...competitorIds, maxVotes + 1) as {
      round: string;
      song_title: string;
      song_artist: string;
      points: number;
      comment: string | null;
    }[];
    boundedVotes = rawVotes.length > maxVotes;
    votesCast = rawVotes.slice(0, maxVotes).map((v) => ({
      round: v.round,
      songTitle: v.song_title,
      songArtist: (v.song_artist.split(',')[0] ?? v.song_artist).trim(),
      pointsGiven: Number(v.points),
      comment: v.comment ?? null,
    }));
  }

  return {
    playerId,
    playerName,
    dossier,
    submissions,
    votesCast,
    tasteOverlap,
    winRate: detail.winRate,
    boundingApplied: boundedSubs || boundedVotes,
  };
}
