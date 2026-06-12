import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// PATCH /api/leagues/:leagueId/next-round — pin the "next round" override for a
// league. Body: { roundId: number | null } (null clears the pin).
// The digest's /next-round endpoint checks this column and prefers it over the
// derived next-chronological-round when present.
export const PATCH: RequestHandler = async ({ params, request }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  const body = (await request.json().catch(() => ({}))) as { roundId?: unknown };
  const roundId = body.roundId;
  if (roundId !== null && !(typeof roundId === 'number' && Number.isInteger(roundId))) {
    throw error(400, 'body.roundId must be an integer or null');
  }

  // Ensure the pinned round belongs to this league.
  if (roundId !== null) {
    const owns = db.prepare(
      `SELECT 1 FROM rounds r JOIN seasons s ON s.id = r.season_id WHERE r.id = ? AND s.league_id = ?`,
    ).get(roundId, leagueId);
    if (!owns) throw error(400, `round ${roundId} does not belong to league ${leagueId}`);
  }

  // Store in league_settings key-value (upsert pattern).
  const key = `next_round_override:${leagueId}`;
  if (roundId === null) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  } else {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, String(roundId));
  }

  return json({ leagueId, nextRoundOverride: roundId });
};

// GET /api/leagues/:leagueId/next-round — read the current pin (or null).
export const GET: RequestHandler = ({ params }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`next_round_override:${leagueId}`) as { value: string } | undefined;
  return json({ leagueId, nextRoundOverride: row ? Number(row.value) : null });
};
