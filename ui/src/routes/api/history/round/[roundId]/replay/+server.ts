import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getVotingReplay } from '$lib/db/votingReplay.js';

// GET /api/history/round/:roundId/replay — one round's voting timeline for the
// Voting Replay panel. Carries the full truth; the public view hides fields at
// render time, which is a presentation choice, not a security boundary.
export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId) || roundId <= 0) throw error(400, 'invalid round id');

  const data = getVotingReplay(getDb(), roundId);
  if (!data) throw error(404, 'round not found');
  return json(data);
};
