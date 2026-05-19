import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// POST /api/digest/:roundId/regenerate — whole-draft regen (skips locked). Stubbed.
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  const body = (await request.json().catch(() => ({}))) as {
    chips?: string[];
    instructions?: string;
  };
  return json({ stub: true, roundId, chips: body.chips ?? [], instructions: body.instructions ?? '', sections: [] });
};
