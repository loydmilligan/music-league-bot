import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  gatherRoundData,
  getActiveDraftForRound,
  getSectionsForDraft,
  incrementWholeRegenCount,
  regenerateOneSection,
  replaceSectionContent,
  enrichPodiumArt,
  addDraftCost,
  type SectionKind,
} from '$lib/digest/llm.js';

// POST /api/digest/:roundId/regenerate — whole-draft regen.
// Runs non-locked sections in parallel; locked sections are skipped entirely.
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  const draft = getActiveDraftForRound(db, roundId);
  if (!draft) throw error(404, `no draft for round ${roundId} — call /draft first`);

  const sections = getSectionsForDraft(db, draft.id);
  const regenerable = sections.filter(s => s.state !== 'locked');
  if (regenerable.length === 0) {
    return json({ draft, sections, skipped: sections.length, regenerated: 0 });
  }

  const body = (await request.json().catch(() => ({}))) as { chips?: string[]; instructions?: string };
  const chips = Array.isArray(body.chips) ? body.chips : [];
  const instructions = typeof body.instructions === 'string' ? body.instructions : '';

  const data = gatherRoundData(db, roundId);

  // Parallel LLM calls (writes happen sequentially after — better-sqlite3
  // transactions are synchronous and a single shared DB connection serializes
  // them anyway).
  const results = await Promise.allSettled(
    regenerable.map(s =>
      regenerateOneSection(data, s.kind as SectionKind, JSON.parse(s.content_json), chips, instructions),
    ),
  );

  const failures: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const content = r.value.section;
      if (regenerable[i].kind === 'podium') enrichPodiumArt(content, data.submissions);
      replaceSectionContent(db, regenerable[i], content, chips, instructions);
      addDraftCost(db, draft.id, r.value.costUsd);
    } else {
      failures.push(`${regenerable[i].kind}: ${(r.reason as Error).message}`);
    }
  });

  incrementWholeRegenCount(db, draft.id);

  const updatedDraft = db.prepare('SELECT * FROM digest_drafts WHERE id = ?').get(draft.id);
  return json({
    draft: updatedDraft,
    sections: getSectionsForDraft(db, draft.id),
    regenerated: regenerable.length - failures.length,
    skipped: sections.length - regenerable.length,
    failures,
  });
};
