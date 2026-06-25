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

  const result = getStandings(db, roundId);

  // Batch-join competitors.player_id → player_avatars for avatar URLs.
  // Also compute deterministic initials+hue for the fallback circle.
  if (result.standings.length > 0) {
    const cids = result.standings.map((r: { competitorId?: number }) => r.competitorId).filter(Boolean) as number[];
    const placeholders = cids.map(() => '?').join(',');
    const playerRows = cids.length > 0
      ? (db.prepare(
          `SELECT c.id AS competitor_id, c.player_id,
                  pa.base_r2_key, pa.themed_r2_key
           FROM competitors c
           LEFT JOIN player_avatars pa ON pa.player_id = c.player_id
           WHERE c.id IN (${placeholders})`
        ).all(...cids) as { competitor_id: number; player_id: number | null; base_r2_key: string | null; themed_r2_key: string | null }[])
      : [];
    const playerMap = new Map(playerRows.map(r => [r.competitor_id, r]));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (result as any).standings = result.standings.map((row) => {
      const pr = playerMap.get(row.competitorId ?? 0);
      const playerId = pr?.player_id ?? null;
      const avatar_url = pr?.themed_r2_key
        ? `/api/avatars/${playerId}/themed`
        : pr?.base_r2_key
        ? `/api/avatars/${playerId}/base`
        : null;
      // Deterministic initials + hue (same formula as buildReadModel.ts)
      const initials = row.name.split(' ').map((w: string) => w[0] ?? '').join('').slice(0, 2).toUpperCase();
      const hue = playerId != null
        ? `oklch(0.72 0.15 ${(playerId * 31) % 360})`
        : `oklch(0.72 0.15 0)`;
      return { ...row, avatar_url, initials, hue };
    });
  }

  return json(result);
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
