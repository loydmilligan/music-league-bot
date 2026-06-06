import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRoundTags, removeRoundTag } from '$lib/db/themeTags.js';

// DELETE /api/rounds/:roundId/tags/:tagId — detach a tag from the round
// (leaves the vocabulary row intact). Returns the round's remaining tags.
export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const tagId = Number(params.tagId);
  if (!roundId) throw error(400, 'invalid roundId');
  if (!tagId) throw error(400, 'invalid tagId');

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM rounds WHERE id = ?').get(roundId)) {
    throw error(404, `round not found: ${roundId}`);
  }
  removeRoundTag(db, roundId, tagId);
  return json({ roundId, tags: getRoundTags(db, roundId) });
};
