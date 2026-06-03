import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound, getSectionsForDraft } from '$lib/digest/llm.js';
import { runDigestExport, isExportFormat, type DigestExportFormat } from '$lib/digest/export.js';
import {
  getLeagueIdForRound,
  readRelContext,
  upsertRelContext,
  proposeRelContextUpdate,
} from '$lib/digest/relContext.js';

// POST /api/digest/:roundId/finalize — render the digest in the chosen format
// (mobile/wide PNG · pdf · png-sections), set finalized_at (idempotent first-set),
// run the rel-context LLM update (failure-isolated), and return the download
// file(s) + diff.
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  // Export format: default to PDF (the primary phone share artifact this sprint).
  let format: DigestExportFormat = 'pdf';
  try {
    const body = (await request.json()) as { format?: unknown };
    if (isExportFormat(body?.format)) format = body.format;
  } catch {
    // No / invalid body → keep the default.
  }

  const db = getDb();
  const round = db
    .prepare('SELECT id, name FROM rounds WHERE id = ?')
    .get(roundId) as { id: number; name: string } | undefined;
  if (!round) throw error(404, `round not found: ${roundId}`);

  const draft = getActiveDraftForRound(db, roundId);
  if (!draft) throw error(409, 'no draft for this round — call /draft first');

  let files;
  try {
    files = await runDigestExport(roundId, format);
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
    format,
    files: files.map((f) => ({
      filename: f.filename,
      downloadUrl: `/api/digest/exports/${f.filename}`,
      bytes: f.bytes,
      contentType: f.contentType,
      label: f.label,
    })),
    relContext,
    warnings,
  });
};
