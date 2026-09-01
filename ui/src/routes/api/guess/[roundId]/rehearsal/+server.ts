import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { startRehearsal, archiveRehearsal } from '$lib/guessing/rehearsal.js';

const StartSchema = z.object({ asOf: z.string().min(1) });

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  const db = getDb();
  const row = db.prepare(`SELECT voting_deadline AS d FROM rounds WHERE id = ?`).get(roundId) as
    | { d: string | null }
    | undefined;
  if (!row) throw error(404, 'round not found');

  const body = await request.json().catch(() => ({}));
  const parsed = StartSchema.safeParse(body);
  // Default the horizon to the round's own voting deadline — the moment the real
  // guess was due (spec §14.3).
  const asOf = parsed.success ? parsed.data.asOf : row.d;
  if (!asOf) throw error(400, 'round has no voting deadline; pass asOf explicitly');

  startRehearsal(db, roundId, asOf);
  return json({ ok: true, asOf });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId)) throw error(404, 'round not found');
  return json({ ok: true, archive: archiveRehearsal(db, roundId) });
};
