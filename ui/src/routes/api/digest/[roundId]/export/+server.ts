import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { runDigestExport, isExportFormat } from '$lib/digest/export.js';

// POST /api/digest/:roundId/export — render the digest in a chosen format and
// return download URL(s). Pure export: does NOT touch finalized_at or run the
// rel-context update (that's finalize's job). Usable in refine OR finalized
// state, re-runnable for any format.
//   Body: { format: 'mobile' | 'wide' | 'pdf' | 'png-sections' }  (default mobile)
//   Returns: { ok, roundId, format, files: [{ filename, downloadUrl, bytes, contentType, label }] }
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  let format: 'mobile' | 'wide' | 'pdf' | 'png-sections' = 'mobile';
  try {
    const body = (await request.json()) as { format?: unknown };
    if (isExportFormat(body?.format)) format = body.format;
  } catch {
    // no/invalid body → mobile default
  }

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);
  const draft = getActiveDraftForRound(db, roundId);
  if (!draft) throw error(409, 'no draft for this round — generate one first');

  let files;
  try {
    files = await runDigestExport(roundId, format);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, `digest export failed: ${msg}`);
  }

  return json({
    ok: true,
    roundId,
    format,
    files: files.map((f) => ({
      filename: f.filename,
      downloadUrl: `/api/digest/exports/${f.filename}`,
      bytes: f.bytes,
      contentType: f.contentType,
      label: f.label,
    })),
  });
};
