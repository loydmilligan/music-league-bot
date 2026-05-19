import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// GET /api/digest/:roundId — full draft + sections + rel context
// Stub: returns 404 until digest pipeline lands (Task 7).
export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db
    .prepare('SELECT id FROM rounds WHERE id = ?')
    .get(roundId) as { id: number } | undefined;
  if (!round) throw error(404, `round not found: ${roundId}`);

  const draft = db
    .prepare('SELECT * FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1')
    .get(roundId) as Record<string, unknown> | undefined;
  if (!draft) throw error(404, `no draft for round ${roundId}`);

  return json({ draft, sections: [], relContext: null });
};

// POST /api/digest/:roundId — dispatcher for /draft | /regenerate | /finalize
// Stub: accepts the action but returns an empty echo until LLM lands.
export const POST: RequestHandler = async ({ params, url }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const action = url.searchParams.get('action') ?? 'draft';
  return json({ ok: true, roundId, action, stub: true });
};
