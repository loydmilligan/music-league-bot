import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getDb } from '$lib/db/client.js';

export const PUT: RequestHandler = async ({ params, request }) => {
	const leagueId = Number(params.leagueId);
	if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'invalid leagueId');
	const body = await request.json().catch(() => ({})) as { mode?: unknown };
	if (body.mode !== 'bot' && body.mode !== 'identity') throw error(400, 'mode must be bot or identity');
	const db = getDb();
	if (!db.prepare('SELECT 1 FROM leagues WHERE id = ?').get(leagueId)) throw error(404, 'league not found');
	db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(`ml_stats_display_name:${leagueId}`, body.mode);
	return json({ mode: body.mode });
};
