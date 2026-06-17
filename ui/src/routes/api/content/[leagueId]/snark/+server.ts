import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// PATCH /api/content/:leagueId/snark
// Body: { level: 0 | 1 | 2 }  (0=gentle, 1=medium, 2=spicy)
export const PATCH: RequestHandler = async ({ params, request }) => {
	const leagueId = Number(params.leagueId);
	if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'invalid leagueId');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}

	if (
		typeof body !== 'object' ||
		body === null ||
		!('level' in body) ||
		![0, 1, 2].includes((body as Record<string, unknown>).level as number)
	) {
		throw error(400, 'level must be 0, 1, or 2');
	}

	const level = (body as { level: number }).level;
	const db = getDb();

	const result = db
		.prepare('UPDATE dashboard_sites SET snark_level = ? WHERE league_id = ?')
		.run(level, leagueId);

	if (result.changes === 0) throw error(404, `league ${leagueId} has no published b-side`);

	return json({ ok: true, snark_level: level });
};
