import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { removeRelationship } from '$lib/db/players.js';

// DELETE /api/players/:playerId/relationships/:relationshipId
export const DELETE: RequestHandler = ({ params }) => {
  const relationshipId = Number(params.relationshipId);
  if (!relationshipId) throw error(400, 'invalid relationshipId');

  const db = getDb();
  const removed = removeRelationship(db, relationshipId);
  if (!removed) throw error(404, `relationship not found: ${relationshipId}`);

  return json({ ok: true });
};
