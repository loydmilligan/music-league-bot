import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { endVotingPhase } from '$lib/db/rounds.js';

// POST /api/rounds/:id/end-voting
// No body required.
// Transitions stored phase: voting → complete.
// Returns nextSubmissionDeadline: the next round's submission_deadline as a suggested prefill.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  try {
    const result = endVotingPhase(db, roundId);
    return json({ phase: 'complete', ...result });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      throw error((e as any).status as number, (e as unknown as Error).message ?? 'error');
    }
    throw e;
  }
};
