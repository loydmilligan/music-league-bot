/**
 * sprint-44 a2: GET /api/digest/:roundId/sections/:id/cover
 *
 * Returns the pipeline cover for a section (if any) for A/B review.
 * Contract 1 from sprint-44 coord-doc: returns CoverData | null.
 *
 * Query strategy:
 *   1. Validate the section belongs to this round.
 *   2. Query digest_regenerations for the most-recent pipeline_cover row.
 *   3. Query llm_cost_log for original and cover calls:
 *      - Original: artifact_id = draftId AND label includes sectionKind but NOT 'cover'
 *      - Cover:    artifact_id = sectionId AND label = 'digest:cover:{kind}'
 *      (sprint-43 fixed cover calls to use sectionId as artifactId; original EP calls
 *       use draftId as artifactId since they cover multiple sections per call.)
 *   4. Query llm_preference for the most-recent pick on this regen row.
 *   5. Return CoverData or { cover: null }.
 *
 * All query failures fall back gracefully — never 500 on missing cost rows.
 */
import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();

  // 1. Validate the section belongs to this round and load section metadata.
  const section = db
    .prepare(
      `SELECT s.id, s.kind, s.draft_id
       FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ? AND d.round_id = ?`,
    )
    .get(sectionId, roundId) as { id: string; kind: string; draft_id: string } | undefined;
  if (!section) throw error(404, `section not found: ${sectionId}`);

  const draftId = section.draft_id;
  const sectionKind = section.kind;

  // 2. Query for the most-recent pipeline_cover regen row.
  const regenRow = db
    .prepare(
      `SELECT id, prior_content_json, new_content_json
       FROM digest_regenerations
       WHERE section_id = ? AND cover_kind = 'pipeline_cover'
       ORDER BY ran_at DESC LIMIT 1`,
    )
    .get(sectionId) as { id: string; prior_content_json: string; new_content_json: string } | undefined;

  if (!regenRow) {
    return json({ cover: null });
  }

  // 3a. Original EP call: artifact_id = draftId, label contains sectionKind but NOT 'cover'.
  //     The EP label format is 'digest:ep{n}:{section}+...' so the kind appears in the label.
  const originalCostRow = db
    .prepare(
      `SELECT id, model, cost_usd, latency_ms
       FROM llm_cost_log
       WHERE artifact_id = ?
         AND label LIKE ?
         AND label NOT LIKE 'digest:cover:%'
       ORDER BY id ASC LIMIT 1`,
    )
    .get(draftId, `%${sectionKind}%`) as
    | { id: number; model: string; cost_usd: number; latency_ms: number }
    | undefined;

  // 3b. Cover call: artifact_id = sectionId (fixed in sprint-44 a3), label = 'digest:cover:{kind}'.
  const coverCostRow = db
    .prepare(
      `SELECT id, model, cost_usd, latency_ms
       FROM llm_cost_log
       WHERE artifact_id = ?
         AND label = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(sectionId, `digest:cover:${sectionKind}`) as
    | { id: number; model: string; cost_usd: number; latency_ms: number }
    | undefined;

  // 4. Most-recent pick for this regen row (append-only; last row is canonical).
  const prefRow = db
    .prepare(
      `SELECT picked FROM llm_preference
       WHERE regen_id = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(regenRow.id) as { picked: 'original' | 'cover' } | undefined;

  // 5. Parse content JSON safely.
  let originalContent: unknown = null;
  let coverContent: unknown = null;
  try { originalContent = JSON.parse(regenRow.prior_content_json); } catch { /* fallback null */ }
  try { coverContent = JSON.parse(regenRow.new_content_json); } catch { /* fallback null */ }

  return json({
    cover: {
      regenId: regenRow.id,
      originalContent,
      coverContent,
      originalModel: originalCostRow?.model ?? 'unknown',
      coverModel: coverCostRow?.model ?? 'unknown',
      originalCostUsd: originalCostRow?.cost_usd ?? 0,
      coverCostUsd: coverCostRow?.cost_usd ?? 0,
      originalLatencyMs: originalCostRow?.latency_ms ?? 0,
      coverLatencyMs: coverCostRow?.latency_ms ?? 0,
      originalCostLogId: originalCostRow?.id ?? null,
      coverCostLogId: coverCostRow?.id ?? null,
      picked: prefRow?.picked ?? null,
    },
  });
};
