import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound, getSectionsForDraft } from '$lib/digest/llm.js';

// GET /api/digest/:roundId — full draft + sections + rel context.
export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db
    .prepare(
      `SELECT r.id, s.league_id FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       WHERE r.id = ?`,
    )
    .get(roundId) as { id: number; league_id: number } | undefined;
  if (!round) throw error(404, `round not found: ${roundId}`);

  const draft = getActiveDraftForRound(db, roundId);
  if (!draft) throw error(404, `no draft for round ${roundId}`);

  const sections = getSectionsForDraft(db, draft.id);
  const relRow = db
    .prepare('SELECT text, updated_at, last_round_id FROM relationship_contexts WHERE league_id = ?')
    .get(round.league_id) as { text: string; updated_at: string; last_round_id: number | null } | undefined;

  return json({
    draft,
    sections,
    relContext: relRow ?? { text: '', updated_at: null, last_round_id: null },
  });
};
