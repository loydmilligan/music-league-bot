import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildH2HState, recordH2HMatch } from '$lib/db/headToHead.js';

interface MatchBody { roundId: number; winnerId: number; loserId: number; }

export const POST: RequestHandler = async ({ request }) => {
  const db = getDb();
  const body = (await request.json()) as Partial<MatchBody>;
  const roundId = Number(body.roundId);
  const winnerId = Number(body.winnerId);
  const loserId = Number(body.loserId);
  if (!roundId || !winnerId || !loserId) throw error(400, 'roundId, winnerId, loserId required');
  if (winnerId === loserId) throw error(400, 'winnerId and loserId must differ');

  const rows = db.prepare(
    'SELECT id, round_id FROM research_songs WHERE id IN (?, ?)'
  ).all(winnerId, loserId) as { id: number; round_id: number }[];
  if (rows.length !== 2) throw error(400, 'winner or loser is not a known research song');
  if (rows.some(r => r.round_id !== roundId)) {
    throw error(400, 'both candidates must belong to the given round');
  }

  let match;
  try {
    match = recordH2HMatch(db, roundId, winnerId, loserId);
  } catch (e: any) {
    throw error(400, `insert failed: ${e?.message ?? String(e)}`);
  }
  return json({ match, state: buildH2HState(db, roundId) }, { status: 201 });
};
