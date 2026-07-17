import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { markSent } from '$lib/digest/sendLog.js';

// POST /api/digest/:roundId/send-confirm — the message landed.
//   Body: { target, url }
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const body = (await request.json().catch(() => ({}))) as { target?: string; url?: string };
  if (!body.target || !body.url) throw error(400, 'target and url are required');

  markSent(getDb(), roundId, {
    sentAt: new Date().toISOString(),
    target: body.target,
    url: body.url,
  });
  return json({ ok: true });
};
