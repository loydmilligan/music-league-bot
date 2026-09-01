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

  setIsMine(db, roundId, uri ?? null);
  return json({ ok: true });
};
