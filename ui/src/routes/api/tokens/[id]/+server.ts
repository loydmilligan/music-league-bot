import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// DELETE /api/tokens/:id — revoke (sets revoked_at; never hard-deletes so audit trail survives).
export const DELETE: RequestHandler = async ({ params }) => {
  const id = Number(params.id);
  if (!id) throw error(400, 'invalid token id');

  const db = getDb();
  const row = db.prepare('SELECT id, revoked_at FROM api_tokens WHERE id = ?').get(id) as
    | { id: number; revoked_at: string | null }
    | undefined;
  if (!row) throw error(404, `token not found: ${id}`);
  if (!row.revoked_at) {
    db.prepare(`UPDATE api_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(id);
  }
  return new Response(null, { status: 204 });
};
