import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { endSubmissionPhase, type EndSubmissionOptions } from '$lib/db/rounds.js';

// POST /api/rounds/:id/end-submission
// Body: { endTimestamp: string, mode: 'accelerated'|'speedy', speedyDays?: number }
// Transitions stored phase: submission → voting.
// Speedy mode shifts voting_deadline to endTimestamp + speedyDays (default 3).
// Accelerated mode leaves voting_deadline unchanged.
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const body = (await request.json().catch(() => ({}))) as Partial<{
    endTimestamp: unknown;
    mode: unknown;
    speedyDays: unknown;
  }>;

  if (typeof body.endTimestamp !== 'string' || !body.endTimestamp) {
    throw error(400, 'endTimestamp must be a non-empty ISO date string');
  }
  if (Number.isNaN(Date.parse(body.endTimestamp))) {
    throw error(400, 'endTimestamp must be a valid ISO date string');
  }
  if (body.mode !== 'accelerated' && body.mode !== 'speedy') {
    throw error(400, "mode must be 'accelerated' or 'speedy'");
  }
  if (body.mode === 'speedy' && body.speedyDays !== undefined) {
    if (typeof body.speedyDays !== 'number' || !Number.isInteger(body.speedyDays) || body.speedyDays < 1) {
      throw error(400, 'speedyDays must be a positive integer');
    }
  }

  const opts: EndSubmissionOptions = {
    endTimestamp: body.endTimestamp,
    mode: body.mode,
    speedyDays: typeof body.speedyDays === 'number' ? body.speedyDays : undefined,
  };

  const db = getDb();
  try {
    const result = endSubmissionPhase(db, roundId, opts);
    return json({ phase: 'voting', ...result });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) {
      throw error((e as any).status as number, (e as unknown as Error).message ?? 'error');
    }
    throw e;
  }
};
