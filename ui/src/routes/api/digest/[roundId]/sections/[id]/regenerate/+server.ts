import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  gatherRoundData,
  regenerateOneSection,
  replaceSectionContent,
  enrichPodiumArt,
  addDraftCost,
  setLlmOutcome,
  type DigestSectionRow,
  type GenParams,
  type SectionKind,
} from '$lib/digest/llm.js';
import { gatherSeasonData } from '$lib/db/seasonData.js';

// POST /api/digest/:roundId/sections/:id/regenerate
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();
  const section = db
    .prepare(
      `SELECT s.*, d.recap_enabled AS recap_enabled, d.recap_final AS recap_final,
              d.rel_context AS draft_rel_context
       FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ? AND d.round_id = ?`,
    )
    .get(sectionId, roundId) as (DigestSectionRow & { recap_enabled: number; recap_final: number; draft_rel_context: string }) | undefined;
  if (!section) throw error(404, `section not found: ${sectionId}`);
  if (section.state === 'locked') throw error(400, 'section is locked');
  if (section.state === 'excluded') throw error(400, 'section is excluded');

  const body = (await request.json().catch(() => ({}))) as { chips?: string[]; instructions?: string };
  const chips = Array.isArray(body.chips) ? body.chips : [];
  const instructions = typeof body.instructions === 'string' ? body.instructions : '';

  // Use the draft's rel_context snapshot so regen of an old round never injects
  // narrative from rounds that came after it (sprint-35 relctx-scope).
  const data = gatherRoundData(db, roundId, { relContextOverride: section.draft_rel_context });
  const priorContent = JSON.parse(section.content_json);

  // sprint-21: regen a recap-mode section with its season slice + recap framing,
  // inherited from the draft (the modal isn't in the loop on regen).
  const recapEnabled = !!section.recap_enabled;
  const genParams: GenParams | undefined = recapEnabled
    ? { recap: { enabled: true, final: !!section.recap_final } }
    : undefined;
  const season = recapEnabled ? gatherSeasonData(db, roundId) : undefined;

  // Retrieve the draft's run_id so this regen groups under the same generation run.
  const draftRow = db.prepare('SELECT run_id FROM digest_drafts WHERE id = ?').get(section.draft_id) as { run_id: string | null } | undefined;
  const runId = draftRow?.run_id ?? undefined;

  let newContent: unknown;
  let costUsd = 0;
  try {
    const res = await regenerateOneSection(
      data,
      section.kind as SectionKind,
      priorContent,
      chips,
      instructions,
      genParams,
      season,
      db,
      runId ? { sectionId, runId } : undefined,
    );
    newContent = res.section;
    costUsd = res.costUsd;
  } catch (e) {
    throw error(502, `LLM regen failed: ${(e as Error).message}`);
  }

  // Re-attach album art if the podium was regenerated (LLM output lacks it).
  if (section.kind === 'podium') enrichPodiumArt(newContent, data.submissions);

  const updated = replaceSectionContent(db, section, newContent, chips, instructions);
  addDraftCost(db, section.draft_id, costUsd);

  // a3: stamp the PRIOR section ledger row as rejected after regen succeeds
  // TODO stage-3: discriminate params/model changes (OQ/CG-1)
  setLlmOutcome({
    db,
    artifactId: sectionId,
    artifactType: 'digest_section',
    outcome: 'rejected',
    regenChanged: 'none',
  });

  return json({ section: updated });
};
