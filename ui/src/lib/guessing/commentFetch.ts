import type Database from 'better-sqlite3';

export interface FetchedSong { spotifyUri: string; comment: string | null }
export interface CommentPayload { ok: boolean; error?: string; songs?: FetchedSong[] }
export interface ApplyResult { updated: number; unmatched: string[] }

/**
 * Apply a voting-page scrape to the round (spec §7.2).
 *
 * A failed scrape is recorded, never thrown: the AI proceeds with a note that
 * comments were unavailable, because a stale or failed scrape must not block
 * the sitting. Only songs actually present in the payload are written — a song
 * whose submitter left no visible comment is absent from it, and must not have
 * an existing comment erased.
 */
export function applyComments(
  db: Database.Database,
  roundId: number,
  payload: CommentPayload,
  now: string,
): ApplyResult {
  const ensureState = db.prepare(
    `INSERT INTO guess_round_state (round_id, updated_at) VALUES (?, ?)
     ON CONFLICT(round_id) DO NOTHING`,
  );

  if (!payload.ok) {
    db.transaction(() => {
      ensureState.run(roundId, now);
      db.prepare(
        `UPDATE guess_round_state SET comments_error = ?, updated_at = ? WHERE round_id = ?`,
      ).run(payload.error ?? 'comment fetch failed', now, roundId);
    })();
    return { updated: 0, unmatched: [] };
  }

  const songs = payload.songs ?? [];
  const unmatched: string[] = [];
  let updated = 0;

  db.transaction(() => {
    ensureState.run(roundId, now);
    const write = db.prepare(
      `UPDATE ml_submissions SET comment = ?
        WHERE round_id = ? AND spotify_uri = ?`,
    );
    for (const s of songs) {
      const info = write.run(s.comment, roundId, s.spotifyUri);
      if (info.changes === 0) unmatched.push(s.spotifyUri);
      else updated += info.changes;
    }
    db.prepare(
      `UPDATE guess_round_state
          SET comments_fetched_at = ?, comments_error = NULL, updated_at = ?
        WHERE round_id = ?`,
    ).run(now, now, roundId);
  })();

  return { updated, unmatched };
}
