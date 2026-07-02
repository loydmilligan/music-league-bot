import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildTasteData } from '$lib/dashboard/tasteData.js';
import { getTasteSettings } from '$lib/db/settings.js';

// GET /api/history/taste — the interaction-level Taste Waveform block for ALL players
// (research tab is cross-league, so archetypes are relative to the whole roster).
export const GET: RequestHandler = async () => {
	const db = getDb();
	const members = db
		.prepare(
			`SELECT DISTINCT p.id AS player_id, p.name
			 FROM players p JOIN ml_submissions s ON s.player_id = p.id
			 ORDER BY p.name`,
		)
		.all() as { player_id: number; name: string }[];
	const tasteSettings = getTasteSettings(db);
	return json(buildTasteData(db, members, tasteSettings));
};
