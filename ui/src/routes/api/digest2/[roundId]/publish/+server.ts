import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';
import { publishDigest2, Digest2PublishError } from '$lib/digest2/publish.js';
import { writePortalJson } from '$lib/portal/portalJson.js';

// POST /api/digest2/:roundId/publish — render the 2.0 digest to digests/d2/<slug>/
// and return its digest-host link. Writes only digest2_shares + digests/d2/.
export const POST: RequestHandler = async ({ params }) => {
	const roundId = Number(params.roundId);
	if (!Number.isInteger(roundId) || roundId <= 0) throw error(400, 'bad round id');
	const db = getDb();
	if (!db.prepare('SELECT 1 FROM rounds WHERE id = ?').get(roundId)) throw error(404, 'round not found');
	if (!getActiveDraftForRound(db, roundId)) throw error(409, 'No story draft yet — press Generate first.');
	let result: Awaited<ReturnType<typeof publishDigest2>>;
	try {
		result = await publishDigest2(roundId);
	} catch (e) {
		if (e instanceof Digest2PublishError) throw error(e.status, e.message);
		throw error(500, `publish failed: ${e instanceof Error ? e.message : String(e)}`);
	}
	let portalWarning: string | undefined;
	try {
		const leagueId = (db.prepare(
			'SELECT s.league_id AS id FROM rounds r JOIN seasons s ON s.id = r.season_id WHERE r.id = ?'
		).get(roundId) as { id: number }).id;
		await writePortalJson(db, leagueId);
	} catch (e) {
		portalWarning = `Published, but the league portal list was not updated: ${e instanceof Error ? e.message : String(e)}`;
		console.warn('[digest2] portal.json write failed', e);
	}
	return json(portalWarning ? { ...result, portalWarning } : result);
};
