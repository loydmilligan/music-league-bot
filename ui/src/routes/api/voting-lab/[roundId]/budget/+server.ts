import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { setRoundBudget } from '$lib/voting-lab/ballotDb.js';

const BudgetSchema = z.object({
  upTotal: z.number().int().min(0),
  downTotal: z.number().int().min(0),
  perSongCap: z.number().int().min(1).nullable(),
});

export const PUT: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const parsed = BudgetSchema.safeParse(await request.json());
  if (!parsed.success) throw error(400, parsed.error.message);

  setRoundBudget(getDb(), roundId, parsed.data);
  return json({ ok: true });
};
