import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getStandings, adoptComputed, applyEdits, type StandingEdit } from '$lib/db/standings.js';

// GET /api/digest/:roundId/standings
// Returns the gospel Standings payload + a reconcile block (computed-vs-stored).
// Lazily computes + persists the table on first access.
export const GET: RequestHandler = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  return json(getStandings(db, roundId));
};

// POST /api/digest/:roundId/standings
//   { action: 'adopt' }                      → overwrite table with computed values
//   { action: 'edit', edits: StandingEdit[] } → write human-corrected values as gospel
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  let body: { action?: unknown; edits?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    throw error(400, 'invalid JSON body');
  }

  if (body.action === 'adopt') {
    return json(adoptComputed(db, roundId));
  }

  if (body.action === 'edit') {
    if (!Array.isArray(body.edits)) throw error(400, 'edit action requires an "edits" array');
    const edits: StandingEdit[] = body.edits
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        competitorId: Number((e as { competitorId: unknown }).competitorId),
        priorTotal: numOrUndef((e as Record<string, unknown>).priorTotal),
        roundPoints: numOrUndef((e as Record<string, unknown>).roundPoints),
        currentTotal: numOrUndef((e as Record<string, unknown>).currentTotal),
      }))
      .filter((e) => Number.isFinite(e.competitorId));
    return json(applyEdits(db, roundId, edits));
  }

  throw error(400, "action must be 'adopt' or 'edit'");
};

function numOrUndef(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
