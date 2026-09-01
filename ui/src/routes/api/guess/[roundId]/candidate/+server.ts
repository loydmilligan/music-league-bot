import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { setCandidate, removeCandidate } from '$lib/guessing/candidates.js';

const CandidateStatusSchema = z.enum(['possible', 'prime', 'locked']);

const PatchFieldsSchema = z.object({
  status: CandidateStatusSchema.optional(),
  certainty: z.number().int().min(0).max(100).nullable().optional(),
  factors: z.string().optional(),
  notes: z.string().optional(),
});

const PatchBodySchema = z.object({
  spotifyUri: z.string().min(1),
  playerId: z.number().int().positive(),
  patch: PatchFieldsSchema,
});

const DeleteBodySchema = z.object({
  spotifyUri: z.string().min(1),
  playerId: z.number().int().positive(),
});

function roundOr404(roundId: number) {
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');
  const db = getDb();
  if (!db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId)) throw error(404, 'round not found');
  return db;
}

/**
 * Refining the reasoning grid — spec's post-gut-lock phase. Unlike mine/gut,
 * this route must NOT gate on gut_locked_at: refining candidates is exactly
 * what the owner does after the gut slate locks, not before.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const db = roundOr404(roundId);

  const parsed = PatchBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw error(400, parsed.error.message);
  const { spotifyUri, playerId, patch } = parsed.data;

  const inRound = db.prepare(
    `SELECT 1 FROM ml_submissions WHERE round_id = ? AND spotify_uri = ?`,
  ).get(roundId, spotifyUri);
  if (!inRound) throw error(400, 'spotifyUri is not a submission in this round');

  setCandidate(db, roundId, spotifyUri, playerId, patch);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const db = roundOr404(roundId);

  const parsed = DeleteBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw error(400, parsed.error.message);
  const { spotifyUri, playerId } = parsed.data;

  const inRound = db.prepare(
    `SELECT 1 FROM ml_submissions WHERE round_id = ? AND spotify_uri = ?`,
  ).get(roundId, spotifyUri);
  if (!inRound) throw error(400, 'spotifyUri is not a submission in this round');

  removeCandidate(db, roundId, spotifyUri, playerId);
  return json({ ok: true });
};
