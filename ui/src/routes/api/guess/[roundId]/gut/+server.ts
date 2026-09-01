import type { RequestHandler } from './$types.js';
import type Database from 'better-sqlite3';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { setGutPick, lockGut } from '$lib/guessing/state.js';
import { validateGutSlate } from '$lib/guessing/assignment.js';
import { resolveMeForRound } from '$lib/guessing/meCompetitor.js';

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

function nameFor(db: Database.Database, competitorId: number): string {
  const row = db.prepare('SELECT name FROM competitors WHERE id = ?').get(competitorId) as
    { name?: string } | undefined;
  return row?.name ?? `#${competitorId}`;
}

export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const db = roundOr404(roundId);

  // spec §7.1: "every song has a pick, and §6 holds. Submitting locks the gut
  // slate." lockGut itself does no validation — the gate belongs here, or a
  // direct POST can lock an incomplete or duplicate-carrying slate PERMANENTLY
  // (setGutPick throws once locked; there is no in-app recovery).
  const me = resolveMeForRound(db, roundId);
  if (me === null) throw error(409, 'no guesser set for this league; cannot validate the gut slate');

  const validation = validateGutSlate(db, roundId, me);
  if (!validation.ok) {
    const parts: string[] = [];
    if (validation.missingSongs.length > 0) {
      parts.push(`${validation.missingSongs.length} song${validation.missingSongs.length === 1 ? '' : 's'} missing a pick`);
    }
    if (validation.duplicatePlayerIds.length > 0) {
      parts.push(`duplicate picks: ${validation.duplicatePlayerIds.map((id) => nameFor(db, id)).join(', ')}`);
    }
    throw error(409, `gut slate is not valid — ${parts.join('; ')}`);
  }

  lockGut(db, roundId, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
  return json({ ok: true });
};
