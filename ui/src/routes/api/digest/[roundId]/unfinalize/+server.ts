import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';

// POST /api/digest/:roundId/unfinalize
// Clears the active draft's finalized_at so the digest re-enters the
// editable / regenerate flow. Idempotent: safe to call on an already-
// unfinalized draft (returns wasFinalized:false, finalizedAt:null).
export const POST: RequestHandler = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  const draft = getActiveDraftForRound(db, roundId);
  if (!draft) throw error(409, 'no draft for this round');

  const wasFinalized = !!draft.finalized_at;
  if (wasFinalized) {
    db.prepare('UPDATE digest_drafts SET finalized_at = NULL WHERE id = ?').run(draft.id);
  }

  return json({ ok: true, roundId, draftId: draft.id, wasFinalized, finalizedAt: null });
};
