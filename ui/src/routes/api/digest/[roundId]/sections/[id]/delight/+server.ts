import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getDb } from '$lib/db/client.js';

// POST /api/digest/:roundId/sections/:id/delight
// Body: { span: string, subsection?: string, note?: string }
// Inserts a row into llm_delight for the given section. cost_log_id is resolved
// from llm_cost_log WHERE artifact_id = sectionId ORDER BY id DESC LIMIT 1.
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();

  // Validate sectionId belongs to this round's draft
  const section = db
    .prepare(
      `SELECT s.id FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ? AND d.round_id = ?`,
    )
    .get(sectionId, roundId) as { id: string } | undefined;
  if (!section) throw error(404, `section not found: ${sectionId}`);

  let body: { span?: unknown; subsection?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }

  if (!body.span || typeof body.span !== 'string' || !body.span.trim()) {
    throw error(400, 'span is required');
  }
  const span = body.span.trim();
  const subsection = typeof body.subsection === 'string' ? body.subsection : null;
  const note = typeof body.note === 'string' ? body.note : null;

  // Resolve cost_log_id from the most-recent llm_cost_log row for this section
  const costLogRow = db
    .prepare(
      `SELECT id FROM llm_cost_log WHERE artifact_id = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(sectionId) as { id: number } | undefined;
  const costLogId = costLogRow?.id ?? null;

  const delightId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO llm_delight (id, cost_log_id, span, subsection, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(delightId, costLogId, span, subsection, note, now);

  return json({ ok: true, delightId });
};
