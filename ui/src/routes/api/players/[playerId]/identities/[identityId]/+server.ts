import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { removePlayerIdentity } from '$lib/db/players.js';

// DELETE /api/players/:playerId/identities/:identityId
export const DELETE: RequestHandler = ({ params }) => {
  const identityId = Number(params.identityId);
  if (!identityId) throw error(400, 'invalid identityId');

  const db = getDb();
  const removed = removePlayerIdentity(db, identityId);
  if (!removed) throw error(404, `identity not found: ${identityId}`);

  return json({ ok: true });
};
