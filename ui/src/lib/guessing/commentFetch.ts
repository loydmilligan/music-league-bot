import type Database from 'better-sqlite3';

export interface FetchedSong { spotifyUri: string; comment: string | null }
export interface CommentPayload { ok: boolean; error?: string; songs?: FetchedSong[] }
export interface ApplyResult { updated: number; unmatched: string[] }

/**
 * Apply a voting-page scrape to the round (spec §7.2).
 *
 * A failed scrape is recorded, never thrown: the AI proceeds with a note that
 * comments were unavailable, because a stale or failed scrape must not block
 * the sitting.
 *
 * The write is COALESCE(?, comment) — a scrape can only ever ADD a comment,
 * never clear one. Two separate reasons:
 *
 *  * The producer (scripts/lib/ml_vote_parse.py) emits EVERY song on the
 *    ballot, with `comment: null` for the ones showing no comment. A null
 *    therefore means "no visible comment on the ballot", which is not evidence
 *    that no comment exists.
 *  * ml_submissions.comment is also populated by the zip import
 *    (lib/import/importer.ts), and that export includes comments the submitter
 *    HID from voters — the very case lib/guessing/horizon.ts gates on with
 *    visible_to_voters. A hidden comment is invisible on the ballot but real in
 *    the column, and it is read with attribution by the digest
 *    (lib/digest/earlyLedes.ts, lib/digest/llm.ts) and by
 *    lib/dashboard/tasteData.ts. Writing the ballot's null over it — on a
 *    backfill, or a rehearsal replay of an already-imported round — would
 *    silently destroy real data.
 *
 * Songs not mentioned in the payload at all are untouched, as before.
 * COALESCE does not weaken the loud-failure property: SQLite counts a matched
 * row as changed even when the value is unchanged, so `unmatched` still flags
 * any uri that hit no row.
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
      `UPDATE ml_submissions SET comment = COALESCE(?, comment)
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
