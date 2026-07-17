import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { markFailed } from '$lib/digest/sendLog.js';

// POST /api/digest/:roundId/send-failed — the send threw.
//
// Deliberately does NOT release the claim. WhatsApp may have accepted the message
// before the error surfaced, so a retry could duplicate it in a real group. The
// round stays claimed until a human decides what happened.
//   Body: { error }
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const body = (await request.json().catch(() => ({}))) as { error?: string };
  markFailed(getDb(), roundId, body.error ?? 'unknown error');
  return json({ ok: true });
};
