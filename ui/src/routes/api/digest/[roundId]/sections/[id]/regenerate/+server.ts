import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  gatherRoundData,
  regenerateOneSection,
  replaceSectionContent,
  enrichPodiumArt,
  addDraftCost,
  type DigestSectionRow,
  type SectionKind,
} from '$lib/digest/llm.js';

// POST /api/digest/:roundId/sections/:id/regenerate
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();
  const section = db
    .prepare(
      `SELECT s.* FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ? AND d.round_id = ?`,
    )
    .get(sectionId, roundId) as DigestSectionRow | undefined;
  if (!section) throw error(404, `section not found: ${sectionId}`);
  if (section.state === 'locked') throw error(400, 'section is locked');

  const body = (await request.json().catch(() => ({}))) as { chips?: string[]; instructions?: string };
  const chips = Array.isArray(body.chips) ? body.chips : [];
  const instructions = typeof body.instructions === 'string' ? body.instructions : '';

  const data = gatherRoundData(db, roundId);
  const priorContent = JSON.parse(section.content_json);

  let newContent: unknown;
  let costUsd = 0;
  try {
    const res = await regenerateOneSection(
      data,
      section.kind as SectionKind,
      priorContent,
      chips,
      instructions,
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
  return json({ section: updated });
};
