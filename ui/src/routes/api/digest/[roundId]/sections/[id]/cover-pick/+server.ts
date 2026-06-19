/**
 * sprint-44 a4: POST /api/digest/:roundId/sections/:id/cover-pick
 *
 * Records a cover A/B pick: writes a preference row, updates the section's
 * published content to the chosen take, and returns the new content so the
 * frontend can update local state without a full reload.
 *
 * Contract 3 from sprint-44 coord-doc.
 *
 * Side effects (in order):
 *   1. Parse + validate body { picked: 'original' | 'cover' }.
 *   2. Validate section belongs to this round; load cover regen row.
 *   3. Call writeCoverPick (fire-and-forget preference row).
 *   4. UPDATE digest_sections.content_json to the picked take (direct UPDATE,
 *      NOT replaceSectionContent — a pick is not a regen event).
 *   5. Return { ok: true, preferenceId, publishedContent }.
 *
 * The preference write is fire-and-forget: failure must never abort the content
 * update. A failed preference write returns preferenceId = '' in the response.
 */
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { writeCoverPick, type SectionKind } from '$lib/digest/llm.js';

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  // 1. Parse and validate body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('picked' in body) ||
    (body as Record<string, unknown>).picked !== 'original' &&
    (body as Record<string, unknown>).picked !== 'cover'
  ) {
    throw error(400, 'body must be { picked: "original" | "cover" }');
  }
  const picked = (body as { picked: 'original' | 'cover' }).picked;

  const db = getDb();

  // 2. Validate section belongs to this round.
  const section = db
    .prepare(
      `SELECT s.id, s.kind, s.draft_id, s.content_json
       FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ? AND d.round_id = ?`,
    )
    .get(sectionId, roundId) as
    | { id: string; kind: string; draft_id: string; content_json: string }
    | undefined;
  if (!section) throw error(404, `section not found: ${sectionId}`);

  // Load the most-recent pipeline_cover regen row for this section.
  const regenRow = db
    .prepare(
      `SELECT id, prior_content_json, new_content_json
       FROM digest_regenerations
       WHERE section_id = ? AND cover_kind = 'pipeline_cover'
       ORDER BY ran_at DESC LIMIT 1`,
    )
    .get(sectionId) as
    | { id: string; prior_content_json: string; new_content_json: string }
    | undefined;
  if (!regenRow) throw error(400, 'no pipeline cover exists for this section');

  // Resolve the content to publish based on the pick.
  //   'cover'    → new_content_json (the cover take)
  //   'original' → prior_content_json (the original take)
  const publishedJson =
    picked === 'cover' ? regenRow.new_content_json : regenRow.prior_content_json;

  // Resolve cost-log IDs for the preference row (best-effort).
  const sectionKind = section.kind as SectionKind;
  const draftId = section.draft_id;

  const originalCostRow = db
    .prepare(
      `SELECT id, model FROM llm_cost_log
       WHERE artifact_id = ?
         AND label LIKE ?
         AND label NOT LIKE 'digest:cover:%'
       ORDER BY id ASC LIMIT 1`,
    )
    .get(draftId, `%${sectionKind}%`) as { id: number; model: string } | undefined;

  const coverCostRow = db
    .prepare(
      `SELECT id, model FROM llm_cost_log
       WHERE artifact_id = ?
         AND label = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(sectionId, `digest:cover:${sectionKind}`) as { id: number; model: string } | undefined;

  // 3. Fire-and-forget preference write.
  const preferenceId = writeCoverPick(db, {
    sectionId,
    section: sectionKind,
    roundId,
    regenId: regenRow.id,
    picked,
    originalModel: originalCostRow?.model ?? 'unknown',
    coverModel: coverCostRow?.model ?? 'unknown',
    originalCostLogId: originalCostRow?.id,
    coverCostLogId: coverCostRow?.id,
  });

  // 4. Update the section's published content (direct UPDATE — not replaceSectionContent;
  //    a pick is not a regen event and must not increment regen_count or insert a regen row).
  db.prepare('UPDATE digest_sections SET content_json = ? WHERE id = ?').run(publishedJson, sectionId);

  // 5. Parse published content for the response.
  let publishedContent: unknown = null;
  try { publishedContent = JSON.parse(publishedJson); } catch { /* fallback null */ }

  return json({ ok: true, preferenceId, publishedContent });
};
