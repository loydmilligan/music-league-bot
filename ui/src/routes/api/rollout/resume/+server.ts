import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { liftHold } from '$lib/rollout/holds.js';

// POST /api/rollout/resume  body { token } | { runId } → { ok, runId }
//
// { token } is the tap-to-resume path from a notification action button.
// { runId } is the RunsView "Resume" button: the dashboard already knows
// which run it means, so it should never make a human copy a token out of
// nowhere to use it (final review C3) — the server resolves the run's
// current resume_token itself.
//
// Either way the token is single-use: liftHold clears it, so a re-tapped
// notification or a repeat click cannot replay a hold already lifted.
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { token?: string; runId?: string };
  let token = body.token;
  if (!token && body.runId) {
    const row = getDb().prepare('SELECT resume_token FROM rollout_runs WHERE id=?')
      .get(body.runId) as { resume_token: string | null } | undefined;
    token = row?.resume_token ?? undefined;
  }
  const res = liftHold(getDb(), token ?? '', new Date().toISOString());
  if (!res.ok) throw error(404, res.reason);
  return json(res);
};
