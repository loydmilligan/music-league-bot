import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  gatherRoundData,
  generateDraft,
  getActiveDraftForRound,
  getSectionsForDraft,
  writeDraft,
} from '$lib/digest/llm.js';

// POST /api/digest/:roundId/draft
// Cached: returns existing draft if one exists; otherwise calls the LLM.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  const cached = getActiveDraftForRound(db, roundId);
  if (cached) {
    return json({ cached: true, draft: cached, sections: getSectionsForDraft(db, cached.id) });
  }

  const data = gatherRoundData(db, roundId);
  let output;
  try {
    output = await generateDraft(data);
  } catch (e) {
    throw error(502, `LLM draft failed: ${(e as Error).message}`);
  }
  const { draft, sections } = writeDraft(db, roundId, data, output, { generated_via: 'POST /draft' });

  return json({ cached: false, draft, sections });
};
