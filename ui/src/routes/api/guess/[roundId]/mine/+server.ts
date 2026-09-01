import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundState } from '$lib/guessing/state.js';
import { setIsMine } from '$lib/voting-lab/ballotDb.js';

/**
 * Mark (or clear) the owner's own song for this round — spec §6. Narrow by
 * design: it must not touch points/notes/comment on the ballot row.
 *
 * Gated once the gut slate locks: is_mine feeds eligibleSongs, so changing it
 * after the lock would invalidate an immutable slate (spec §7.1).
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId)) throw error(404, 'round not found');

  if (getRoundState(db, roundId).gutLockedAt !== null) {
    throw error(409, 'gut slate is locked — your song cannot be changed now');
  }

  const body = (await request.json().catch(() => ({}))) as { spotifyUri?: unknown };
  const uri = body.spotifyUri;
  if (uri !== null && typeof uri !== 'string') throw error(400, 'spotifyUri must be a string or null');

  // Only the mark path: an unknown or cross-round uri would create a
  // voting_lab_ballot row with is_mine=1 on a phantom song, consuming the
  // round's single exclusive mark while the UI still says "mark your own song
  // first" — a 200 with no visible effect. Clearing (null) needs no song.
  if (typeof uri === 'string') {
    const inRound = db.prepare(
      `SELECT 1 FROM ml_submissions WHERE round_id = ? AND spotify_uri = ?`,
    ).get(roundId, uri);
    if (!inRound) throw error(400, 'spotifyUri is not a submission in this round');
  }

  setIsMine(db, roundId, uri ?? null);
  return json({ ok: true });
};
