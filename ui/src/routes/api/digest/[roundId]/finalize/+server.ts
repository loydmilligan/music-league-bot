import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { renderDigestPng } from '$lib/digest/export.js';

// POST /api/digest/:roundId/finalize — render .dg-export to PNG, set finalized_at (idempotent first-set), return download URL.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  const draft = getActiveDraftForRound(db, roundId);
  if (!draft) throw error(409, 'no draft for this round — call /draft first');

  let result;
  try {
    result = await renderDigestPng(roundId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, `digest export failed: ${msg}`);
  }

  const firstFinalize = !draft.finalized_at;
  const finalizedAt = draft.finalized_at ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (firstFinalize) {
    db.prepare('UPDATE digest_drafts SET finalized_at = ? WHERE id = ?').run(finalizedAt, draft.id);
  }

  return json({
    ok: true,
    roundId,
    draftId: draft.id,
    finalizedAt,
    firstFinalize,
    filename: result.filename,
    bytes: result.bytes,
    downloadUrl: `/api/digest/exports/${result.filename}`,
  });
};
