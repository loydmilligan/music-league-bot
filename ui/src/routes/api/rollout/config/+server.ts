import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getRolloutConfig, putRolloutConfig } from '$lib/rollout/store.js';
import { isValidRollout } from '$lib/rollout/validate.js';

function leagueId(url: URL): number {
  const raw = url.searchParams.get('leagueId');
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n <= 0) throw error(400, 'leagueId is required');
  return n;
}

// GET /api/rollout/config?leagueId=N → { rollout, enabled }
// Never 404s and never returns null: an unset or malformed config degrades to
// the default, DISABLED — same contract as /api/settings/pipeline-config.
export const GET: RequestHandler = async ({ url }) => json(getRolloutConfig(getDb(), leagueId(url)));

// PUT /api/rollout/config?leagueId=N  body { rollout, enabled? }
export const PUT: RequestHandler = async ({ url, request }) => {
  const id = leagueId(url);
  const body = (await request.json()) as { rollout?: unknown; enabled?: unknown };
  if (!isValidRollout(body.rollout)) throw error(400, 'invalid rollout definition');
  const enabled = body.enabled === true;
  putRolloutConfig(getDb(), id, body.rollout, enabled, new Date().toISOString());
  return json(getRolloutConfig(getDb(), id));
};
