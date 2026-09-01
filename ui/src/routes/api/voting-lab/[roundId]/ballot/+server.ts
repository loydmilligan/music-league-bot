import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { saveBallotEntry } from '$lib/voting-lab/ballotDb.js';

const BallotEntrySchema = z.object({
  spotifyUri: z.string().min(1),
  upPoints: z.number().int().min(0),
  downPoints: z.number().int().min(0),
  rating: z.number().int().min(1).max(5).nullable(),
  notes: z.string(),
  draftComment: z.string(),
  // Accepted for wire compatibility with the existing client, which re-sends
  // its whole mount-time entry on every edit — and IGNORED: `saveBallotEntry`
  // does not write is_mine. Only /api/guess/[roundId]/mine (setIsMine) may,
  // and only before the gut slate locks.
  isMine: z.boolean(),
});

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const body = await request.json().catch(() => ({}));
  const parsed = BallotEntrySchema.safeParse(body);
  if (!parsed.success) throw error(400, parsed.error.message);

  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId);
  if (!exists) throw error(404, 'round not found');

  saveBallotEntry(db, roundId, parsed.data);
  return json({ ok: true });
};
