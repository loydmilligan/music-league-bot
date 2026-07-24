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

  const body = await request.json().catch(() => ({}));
  const parsed = BudgetSchema.safeParse(body);
  if (!parsed.success) throw error(400, parsed.error.message);

  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId);
  if (!exists) throw error(404, 'round not found');

  setRoundBudget(db, roundId, parsed.data);
  return json({ ok: true });
};
