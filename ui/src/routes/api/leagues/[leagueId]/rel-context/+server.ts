import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

interface RelContextRow {
  league_id: number;
  text: string;
  updated_at: string;
  last_round_id: number | null;
}

// GET /api/leagues/:leagueId/rel-context — current relationship context.
export const GET: RequestHandler = async ({ params }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  const row = db
    .prepare('SELECT league_id, text, updated_at, last_round_id FROM relationship_contexts WHERE league_id = ?')
    .get(leagueId) as RelContextRow | undefined;

  return json(row ?? { league_id: leagueId, text: '', updated_at: null, last_round_id: null });
};

// PATCH /api/leagues/:leagueId/rel-context — manual edit. Stubbed (upsert without LLM).
export const PATCH: RequestHandler = async ({ params, request }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = typeof body.text === 'string' ? body.text : '';

  db.prepare(
    `INSERT INTO relationship_contexts (league_id, text)
     VALUES (?, ?)
     ON CONFLICT(league_id) DO UPDATE SET
       text = excluded.text,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  ).run(leagueId, text);

  const row = db
    .prepare('SELECT league_id, text, updated_at, last_round_id FROM relationship_contexts WHERE league_id = ?')
    .get(leagueId) as RelContextRow;

  return json(row);
};
