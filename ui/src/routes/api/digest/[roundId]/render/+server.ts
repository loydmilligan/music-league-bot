import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { renderDigestHtml } from '$lib/digest/export.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';

// POST /api/digest/:roundId/render — render the share page and return its name +
// public url. For manual sends of ANY round to ANY group. Unlike send-claim it
// takes no claim and touches no idempotency state, so it is safe to test freely.
//   Returns: { roundId, name, url }
export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id, name FROM rounds WHERE id = ?').get(roundId) as
    | { id: number; name: string }
    | undefined;
  if (!round) throw error(404, `round not found: ${roundId}`);
  if (!getActiveDraftForRound(db, roundId)) {
    throw error(409, 'no draft for this round — generate one first');
  }

  try {
    const { url } = await renderDigestHtml(roundId);
    return json({ roundId, name: round.name, url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, `digest render failed: ${msg}`);
  }
};
