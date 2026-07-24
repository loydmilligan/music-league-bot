import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildLabData } from '$lib/voting-lab/labData.js';

export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId);
  if (!exists) throw error(404, 'round not found');

  return json(buildLabData(db, roundId));
};
