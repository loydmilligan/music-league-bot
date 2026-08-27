import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { liftHold } from '$lib/rollout/holds.js';

// POST /api/rollout/resume  body { token } → { ok, runId }
// The token is single-use: liftHold clears it, so a re-tapped ntfy notification
// cannot replay a hold that has already been lifted.
export const POST: RequestHandler = async ({ request }) => {
  const { token } = (await request.json()) as { token?: string };
  const res = liftHold(getDb(), token ?? '', new Date().toISOString());
  if (!res.ok) throw error(404, res.reason);
  return json(res);
};
