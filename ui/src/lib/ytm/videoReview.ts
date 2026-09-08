import type Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import type { VideoPlaylistConfig, VideoPickBand } from '$lib/db/videoPlaylist.js';

/**
 * Human-in-the-loop review for a round's music-video playlist.
 *
 * The drop script resolves candidates and parks them here; a human decides the
 * borderline ones on /ytm/[roundId]/videos; approval builds the playlist and
 * posts it. Modelled on the digest HiL flow (lib/digest/approvals.ts) — same
 * single-use token, same claim-before-side-effects discipline.
 *
 * Why the playlist is built at APPROVAL and not at resolve time: the whole
 * point of the review is that the contents change. Building first would mean
 * either editing a live playlist afterwards or orphaning it and handing the
 * group a different link from the one that was reviewed.
 */

export type ReviewStatus = 'pending' | 'approved' | 'denied' | 'sent' | 'failed';

export interface VideoCandidate {
  videoId: string;
  title: string;
  channel: string | null;
  score: number;
  /** Added by a human on the review page rather than found by the drop. */
  manual?: boolean;
}

/** A bare id, or any of the YouTube URL shapes people paste. Null if neither. */
export function parseYoutubeVideoId(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  const patterns = [
    /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:[^\s]*&)?v=([A-Za-z0-9_-]{11})/i,
    /youtu\.be\/([A-Za-z0-9_-]{11})/i,
    /youtube\.com\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  return null;
}

export interface VideoPick {
  title: string;
  artists: string;
  spotifyUri: string;
  source: 'comment' | 'search' | null;
  score: number;
  band: VideoPickBand;
  candidates: VideoCandidate[];
  /**
   * Selected videos, in the order they should appear. A song can carry more
   * than one — a round about videos sometimes has a song with an official cut
   * AND the one everybody actually means. Empty = no video for this song.
   */
  chosen: string[];
  included: boolean;
  /** False only for an unanswered `review` pick — those block approval. */
  decided: boolean;
  reason: string | null;
}

export interface VideoReview {
  roundId: number;
  leagueId: number;
  status: ReviewStatus;
  token: string | null;
  snoozeUntil: string | null;
  picks: VideoPick[];
  config: VideoPlaylistConfig;
  target: string;
  audioUrl: string | null;
  audioSent: boolean;
  videoUrl: string | null;
  error: string | null;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function ensureVideoReviewSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ytm_video_reviews (
      round_id     INTEGER PRIMARY KEY REFERENCES rounds(id),
      league_id    INTEGER NOT NULL,
      status       TEXT NOT NULL,
      token        TEXT UNIQUE,
      snooze_until TEXT,
      picks        TEXT NOT NULL,
      config       TEXT NOT NULL,
      target       TEXT NOT NULL,
      audio_url    TEXT,
      audio_sent   INTEGER NOT NULL DEFAULT 0,
      video_url    TEXT,
      error        TEXT,
      notified_at  TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
  `);
}

export function generateReviewToken(): string {
  return randomBytes(24).toString('base64url');
}

type Row = {
  round_id: number; league_id: number; status: string; token: string | null;
  snooze_until: string | null; picks: string; config: string; target: string;
  audio_url: string | null; audio_sent: number; video_url: string | null;
  error: string | null; notified_at: string | null; created_at: string; updated_at: string;
};

/**
 * `chosen` was a single id (or null) before 2026-09-07. Rows parked then are
 * still live, so widen on read rather than migrating the table — the shape is
 * a JSON blob and a half-migrated blob is worse than a tolerant reader.
 */
function hydratePicks(raw: unknown): VideoPick[] {
  return (raw as VideoPick[]).map((p) => ({
    ...p,
    chosen: Array.isArray(p.chosen) ? p.chosen : p.chosen ? [p.chosen as unknown as string] : [],
  }));
}

function hydrate(r: Row): VideoReview {
  return {
    roundId: r.round_id,
    leagueId: r.league_id,
    status: r.status as ReviewStatus,
    token: r.token,
    snoozeUntil: r.snooze_until,
    picks: hydratePicks(JSON.parse(r.picks)),
    config: JSON.parse(r.config) as VideoPlaylistConfig,
    target: r.target,
    audioUrl: r.audio_url,
    audioSent: r.audio_sent === 1,
    videoUrl: r.video_url,
    error: r.error,
    notifiedAt: r.notified_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getReview(db: Database.Database, roundId: number): VideoReview | null {
  const row = db.prepare('SELECT * FROM ytm_video_reviews WHERE round_id = ?').get(roundId) as Row | undefined;
  return row ? hydrate(row) : null;
}

export function getReviewByToken(db: Database.Database, token: string): VideoReview | null {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM ytm_video_reviews WHERE token = ?').get(token) as Row | undefined;
  return row ? hydrate(row) : null;
}

export interface UpsertReviewInput {
  roundId: number;
  leagueId: number;
  picks: VideoPick[];
  config: VideoPlaylistConfig;
  target: string;
  audioUrl: string | null;
  audioSent: boolean;
}

/**
 * Park a freshly resolved set of candidates for review, minting a token.
 *
 * Re-resolving a round that is already `sent` is refused rather than silently
 * reopened: the group has the link, and a second playlist would be a second
 * message nobody asked for.
 */
export function upsertReview(db: Database.Database, input: UpsertReviewInput, nowIso: string): VideoReview {
  const existing = getReview(db, input.roundId);
  if (existing && (existing.status === 'sent' || existing.status === 'denied')) return existing;
  const token = existing?.token ?? generateReviewToken();
  db.prepare(
    `INSERT INTO ytm_video_reviews
       (round_id, league_id, status, token, snooze_until, picks, config, target, audio_url, audio_sent, created_at, updated_at)
     VALUES (@round_id, @league_id, 'pending', @token, NULL, @picks, @config, @target, @audio_url, @audio_sent, @now, @now)
     ON CONFLICT(round_id) DO UPDATE SET
       league_id=excluded.league_id, status='pending', token=excluded.token, snooze_until=NULL,
       picks=excluded.picks, config=excluded.config, target=excluded.target,
       audio_url=excluded.audio_url, audio_sent=excluded.audio_sent,
       error=NULL, updated_at=excluded.updated_at`,
  ).run({
    round_id: input.roundId,
    league_id: input.leagueId,
    token,
    picks: JSON.stringify(input.picks),
    config: JSON.stringify(input.config),
    target: input.target,
    audio_url: input.audioUrl,
    audio_sent: input.audioSent ? 1 : 0,
    now: nowIso,
  });
  return getReview(db, input.roundId)!;
}

/** Picks that must be answered before approval is allowed. */
export function undecidedPicks(picks: VideoPick[]): VideoPick[] {
  return picks.filter((p) => p.band === 'review' && !p.decided);
}

/**
 * Videos that would go into the playlist right now, in submission order then
 * selection order. De-duplicated: two songs can legitimately land on the same
 * video, and YouTube would happily add it twice.
 */
export function includedVideoIds(picks: VideoPick[]): string[] {
  const out: string[] = [];
  for (const p of picks) {
    if (!p.included) continue;
    for (const id of p.chosen) if (!out.includes(id)) out.push(id);
  }
  return out;
}

export interface PickDecision {
  spotifyUri: string;
  /** The full selected set for this song. [] = no video for this song. */
  chosen?: string[];
  included?: boolean;
  /**
   * A YouTube URL or bare id typed in by a human. Appended to this pick's
   * candidates and selected. This is the ONE way a videoId that the drop never
   * found can enter the playlist.
   */
  addVideo?: string;
  /** Title/channel for an added video, when a search supplied them. */
  addVideoTitle?: string;
  addVideoChannel?: string;
}

/**
 * Apply the page's choices. Answering a `review` pick marks it decided —
 * including answering it with "no video", which is a real answer and must not
 * leave approval blocked forever.
 */
export function applyDecisions(
  db: Database.Database, roundId: number, decisions: PickDecision[], nowIso: string,
): VideoReview | null {
  const review = getReview(db, roundId);
  if (!review) return null;
  if (review.status !== 'pending') return review;
  const byUri = new Map(decisions.map((d) => [d.spotifyUri, d]));
  const picks = review.picks.map((p) => {
    const d = byUri.get(p.spotifyUri);
    if (!d) return p;
    const next: VideoPick = { ...p, candidates: [...p.candidates], chosen: [...p.chosen] };

    // A human-supplied link is the only route by which a video the drop never
    // found can reach the playlist, so it is added to the candidate list first
    // and then goes through exactly the same membership check as the rest.
    if (d.addVideo) {
      const id = parseYoutubeVideoId(d.addVideo);
      if (id) {
        if (!next.candidates.some((c) => c.videoId === id)) {
          next.candidates.push({
            videoId: id,
            title: d.addVideoTitle ?? 'Added by hand',
            channel: d.addVideoChannel ?? null,
            score: 100,
            manual: true,
          });
        }
        if (!next.chosen.includes(id)) next.chosen.push(id);
      }
    }

    if (d.chosen !== undefined) {
      // Only ids this pick actually offers — the page must not be able to
      // inject an arbitrary video without going through addVideo.
      next.chosen = d.chosen.filter(
        (id, i, arr) => arr.indexOf(id) === i && next.candidates.some((c) => c.videoId === id),
      );
    }
    if (d.included !== undefined) next.included = d.included;
    // Selecting nothing AND including it is incoherent; treat it as excluded.
    // Selecting something after having none is a clear "yes, include this".
    if (next.chosen.length === 0) next.included = false;
    else if (p.chosen.length === 0 && d.included === undefined) next.included = true;
    if (p.band === 'review') next.decided = true;
    return next;
  });
  db.prepare('UPDATE ytm_video_reviews SET picks=?, updated_at=? WHERE round_id=?')
    .run(JSON.stringify(picks), nowIso, roundId);
  return getReview(db, roundId);
}

export interface ClaimResult {
  ok: boolean;
  roundId?: number;
  reason?: string;
}

/**
 * Verify + CONSUME the single-use token and mark the review approved, in one
 * UPDATE, before any side effect — so a double-tap cannot build two playlists.
 * Refuses while any `review` pick is unanswered, which is the whole point of
 * the band.
 */
export function claimApproval(db: Database.Database, token: string, now: () => string): ClaimResult {
  const review = getReviewByToken(db, token);
  if (!review) return { ok: false, reason: 'invalid or already-used token' };
  if (review.status !== 'pending') {
    return { ok: false, reason: `round ${review.roundId} is not pending (status=${review.status})` };
  }
  const pending = undecidedPicks(review.picks);
  if (pending.length) {
    return { ok: false, reason: `${pending.length} video(s) still need a decision` };
  }
  const t = now();
  db.prepare(
    `UPDATE ytm_video_reviews SET token=NULL, status='approved', snooze_until=NULL, updated_at=? WHERE round_id=?`,
  ).run(t, review.roundId);
  return { ok: true, roundId: review.roundId };
}

export function denyReview(db: Database.Database, token: string, now: () => string): ClaimResult {
  const review = getReviewByToken(db, token);
  if (!review) return { ok: false, reason: 'invalid or already-used token' };
  if (review.status !== 'pending') {
    return { ok: false, reason: `round ${review.roundId} is not pending (status=${review.status})` };
  }
  // Picks are kept: denying drops the video playlist for this round, it does
  // not undo anything already posted, and the page stays readable.
  db.prepare(`UPDATE ytm_video_reviews SET token=NULL, status='denied', updated_at=? WHERE round_id=?`)
    .run(now(), review.roundId);
  return { ok: true, roundId: review.roundId };
}

export const SNOOZE_MS = 4 * 60 * 60 * 1000;

/**
 * Go quiet for four hours. The token SURVIVES — a snooze is "ask me later", not
 * a decision, so the notification's own Approve/Deny actions must keep working
 * if the user comes back to the old notification.
 */
export function snoozeReview(db: Database.Database, token: string, now: () => Date): ClaimResult {
  const review = getReviewByToken(db, token);
  if (!review) return { ok: false, reason: 'invalid or already-used token' };
  if (review.status !== 'pending') {
    return { ok: false, reason: `round ${review.roundId} is not pending (status=${review.status})` };
  }
  const until = new Date(now().getTime() + SNOOZE_MS).toISOString();
  db.prepare('UPDATE ytm_video_reviews SET snooze_until=?, updated_at=? WHERE round_id=?')
    .run(until, now().toISOString(), review.roundId);
  return { ok: true, roundId: review.roundId };
}

export function markSent(db: Database.Database, roundId: number, videoUrl: string, nowIso: string): void {
  db.prepare(`UPDATE ytm_video_reviews SET status='sent', video_url=?, error=NULL, updated_at=? WHERE round_id=?`)
    .run(videoUrl, nowIso, roundId);
}

export function markFailed(db: Database.Database, roundId: number, error: string, nowIso: string): void {
  db.prepare(`UPDATE ytm_video_reviews SET status='failed', error=?, updated_at=? WHERE round_id=?`)
    .run(error.slice(0, 400), nowIso, roundId);
}

/**
 * Reviews due for a (re-)notification: still pending, and either never notified
 * or past their snooze. Drives the re-nudge from the existing 15-minute timer,
 * so a snooze needs no scheduler of its own.
 */
export function reviewsDueForNotify(db: Database.Database, nowIso: string): VideoReview[] {
  const rows = db.prepare(
    `SELECT * FROM ytm_video_reviews
      WHERE status='pending'
        AND (notified_at IS NULL OR (snooze_until IS NOT NULL AND snooze_until <= ?))`,
  ).all(nowIso) as Row[];
  return rows.map(hydrate);
}

export function markNotified(db: Database.Database, roundId: number, nowIso: string): void {
  db.prepare('UPDATE ytm_video_reviews SET notified_at=?, snooze_until=NULL, updated_at=? WHERE round_id=?')
    .run(nowIso, nowIso, roundId);
}
