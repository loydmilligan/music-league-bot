import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getSeasonSettings, setSeasonSettings, writePortalJson } from '$lib/portal/portalJson.js';
import type { RequestHandler } from './$types.js';

function leagueIdOf(params: { leagueId: string }): number {
  const id = Number(params.leagueId);
  if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid league id');
  return id;
}

function requireLeague(id: number) {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM leagues WHERE id = ?').get(id)) throw error(404, 'league not found');
  return db;
}

export const GET: RequestHandler = async ({ params }) => {
  const id = leagueIdOf(params);
  const db = requireLeague(id);
  return json(getSeasonSettings(db, id));
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const id = leagueIdOf(params);
  const db = requireLeague(id);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ok = (v: unknown) => v === null || typeof v === 'string';
  if (!body || typeof body !== 'object' || !ok(body.feedUrl) || !ok(body.hubUrl)) {
    throw error(400, 'body must be { feedUrl: string|null, hubUrl: string|null }');
  }
  try {
    setSeasonSettings(db, id, { feedUrl: body.feedUrl as string | null, hubUrl: body.hubUrl as string | null });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid url');
  }
  try {
    const written = await writePortalJson(db, id);
    return json({ ok: true, portalWritten: written !== null });
  } catch (e) {
    const warning = `portal.json not updated: ${e instanceof Error ? e.message : String(e)}`;
    console.error('[portal]', warning);
    return json({ ok: true, portalWritten: false, warning });
  }
};
