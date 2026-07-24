import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { setSeasonBudget } from '$lib/voting-lab/ballotDb.js';

const Body = z.object({
  seasonId: z.number().int().positive(),
  upTotal: z.number().int().min(0),
  downTotal: z.number().int().min(0),
  perSongCap: z.number().int().min(1).nullable(),
});

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw error(400, parsed.error.message);

  const { seasonId, ...budget } = parsed.data;

  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM seasons WHERE id = ?`).get(seasonId);
  if (!exists) throw error(404, 'season not found');

  setSeasonBudget(db, seasonId, budget);
  return json({ ok: true });
};
