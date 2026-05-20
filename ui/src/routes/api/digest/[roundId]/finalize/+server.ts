import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound, getSectionsForDraft } from '$lib/digest/llm.js';
import { renderDigestPng } from '$lib/digest/export.js';
import {
  getLeagueIdForRound,
  readRelContext,
  upsertRelContext,
  proposeRelContextUpdate,
} from '$lib/digest/relContext.js';

// POST /api/digest/:roundId/finalize — render .dg-export to PNG, set finalized_at (idempotent
// first-set), run rel-context LLM update with failure isolation, return download URL + diff.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db
    .prepare('SELECT id, name FROM rounds WHERE id = ?')
    .get(roundId) as { id: number; name: string } | undefined;
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

  // Rel-context update — failure-isolated. The PNG export is the primary product; if the
  // LLM call fails (no key, model error, parse fail), the finalize call still succeeds.
  let relContext: { previous: string; proposed: string; updatedAt: string; leagueId: number } | null = null;
  const warnings: string[] = [];
  try {
    const leagueId = getLeagueIdForRound(db, roundId);
    if (leagueId == null) {
      warnings.push('rel-context skipped: could not resolve league for round');
    } else {
      const current = readRelContext(db, leagueId);
      const sections = getSectionsForDraft(db, draft.id);
      const proposed = await proposeRelContextUpdate(current.context, sections, round.name);
      const updated = upsertRelContext(db, leagueId, proposed, roundId);
      relContext = {
        leagueId,
        previous: current.context,
        proposed,
        updatedAt: updated.updatedAt ?? finalizedAt,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`rel-context update failed: ${msg}`);
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
    relContext,
    warnings,
  });
};
