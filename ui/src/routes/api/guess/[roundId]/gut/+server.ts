import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { setGutPick, lockGut } from '$lib/guessing/state.js';

const PickSchema = z.object({
  spotifyUri: z.string().min(1),
  playerId: z.number().int().positive(),
});

function roundOr404(roundId: number) {
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId)) throw error(404, 'round not found');
  return db;
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const db = roundOr404(roundId);

  const parsed = PickSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw error(400, parsed.error.message);

  try {
    setGutPick(db, roundId, parsed.data.spotifyUri, parsed.data.playerId);
  } catch (e) {
    // spec §7.1: gut picks are immutable once locked. Surface it, never work around it.
    throw error(409, e instanceof Error ? e.message : 'gut slate is locked');
  }
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const db = roundOr404(roundId);
  lockGut(db, roundId, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  return json({ ok: true });
};
