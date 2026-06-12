import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getNextRound } from '$lib/db/nextRound.js';

type DraftRow = {
  id: number;
  next_round_excluded: number;
  next_round_theme_override: string | null;
  next_round_sub_deadline_override: string | null;
  next_round_vote_deadline_override: string | null;
};

function getActiveDraft(db: ReturnType<typeof getDb>, roundId: number): DraftRow | undefined {
  return db
    .prepare(
      `SELECT id, next_round_excluded, next_round_theme_override,
              next_round_sub_deadline_override, next_round_vote_deadline_override
       FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1`,
    )
    .get(roundId) as DraftRow | undefined;
}

// GET /api/digest/:roundId/next-round → computed next-round data with draft overrides applied
export const GET: RequestHandler = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();
  if (!db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId)) throw error(404, `round not found: ${roundId}`);

  let nextRound = getNextRound(db, roundId);
  const draft = getActiveDraft(db, roundId);

  const excluded = !!(draft?.next_round_excluded);
  const hasOverride = !!(
    draft?.next_round_theme_override != null ||
    draft?.next_round_sub_deadline_override != null ||
    draft?.next_round_vote_deadline_override != null
  );

  // Apply overrides: stored value wins over computed when non-null.
  if (nextRound && draft) {
    if (draft.next_round_theme_override != null) {
      nextRound = { ...nextRound, theme: draft.next_round_theme_override };
    }
    if (draft.next_round_sub_deadline_override != null) {
      nextRound = { ...nextRound, submissionDeadline: draft.next_round_sub_deadline_override };
    }
    if (draft.next_round_vote_deadline_override != null) {
      nextRound = { ...nextRound, votingDeadline: draft.next_round_vote_deadline_override };
    }
  }

  return json({ nextRound, excluded, hasOverride });
};

// PATCH /api/digest/:roundId/next-round — persist exclude flag + theme/deadline overrides
export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();

  const draft = getActiveDraft(db, roundId);
  if (!draft) throw error(404, 'no active draft for this round');

  const body = (await request.json()) as {
    excluded?: boolean;
    themeOverride?: string | null;
    submissionDeadlineOverride?: string | null;
    votingDeadlineOverride?: string | null;
  };

  const fields: string[] = [];
  const values: unknown[] = [];

  if (body.excluded !== undefined) {
    fields.push('next_round_excluded = ?');
    values.push(body.excluded ? 1 : 0);
  }
  if ('themeOverride' in body) {
    fields.push('next_round_theme_override = ?');
    values.push(body.themeOverride ?? null);
  }
  if ('submissionDeadlineOverride' in body) {
    fields.push('next_round_sub_deadline_override = ?');
    values.push(body.submissionDeadlineOverride ?? null);
  }
  if ('votingDeadlineOverride' in body) {
    fields.push('next_round_vote_deadline_override = ?');
    values.push(body.votingDeadlineOverride ?? null);
  }

  if (fields.length === 0) throw error(400, 'nothing to update');

  db.prepare(`UPDATE digest_drafts SET ${fields.join(', ')} WHERE id = ?`).run(...values, draft.id);

  return json({ ok: true });
};
