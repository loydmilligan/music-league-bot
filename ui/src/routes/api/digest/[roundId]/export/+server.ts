import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { runDigestExport, isExportFormat, renderDigestHtml } from '$lib/digest/export.js';

// POST /api/digest/:roundId/export — render the digest in a chosen format and
// return download URL(s). Pure export: does NOT touch finalized_at or run the
// rel-context update (that's finalize's job). Usable in refine OR finalized
// state, re-runnable for any format.
//   Body: { format: 'mobile' | 'wide' | 'pdf' | 'png-sections' | 'html' }  (default mobile)
//   Returns (screenshot formats): { ok, roundId, format, files: [{ filename, downloadUrl, bytes, contentType, label }] }
//   Returns (html share, sprint-20):  { ok, roundId, format: 'html', slug, url }
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  let requested: unknown;
  try {
    requested = ((await request.json()) as { format?: unknown })?.format;
  } catch {
    // no/invalid body → mobile default (handled below)
  }

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);
  const draft = getActiveDraftForRound(db, roundId);
  if (!draft) throw error(409, 'no draft for this round — generate one first');

  // html share (sprint-20): peer format that renders the LIVE interactive digest
  // into a self-contained folder-per-slug artifact in the shared digests/ volume
  // and returns its STABLE public URL (re-export overwrites in place, same slug).
  if (requested === 'html') {
    try {
      const { slug, url } = await renderDigestHtml(roundId);
      return json({ ok: true, roundId, format: 'html', slug, url });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw error(502, `digest html export failed: ${msg}`);
    }
  }

  const format: 'mobile' | 'wide' | 'pdf' | 'png-sections' = isExportFormat(requested)
    ? requested
    : 'mobile';

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
