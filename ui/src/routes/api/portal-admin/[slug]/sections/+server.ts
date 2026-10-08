import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { requirePortalAdmin } from '$lib/portalAdmin/api.js';
import { KPI_CATALOG, SECTION_IDS, type KpiId } from '$lib/portalAdmin/config.js';
import { readConfig } from '$lib/portalAdmin/store.js';
import { nextDueAfter } from '$lib/portalAdmin/schedule.js';
import { getAllPlayers } from '$lib/db/players.js';

const KPI_LABELS: Record<KpiId, string> = {
	songs: 'Songs',
	points: 'Points',
	winners: 'Winners',
	noteWords: 'Review words',
};

export const GET: RequestHandler = async (event) => {
	const { db, leagueId } = requirePortalAdmin(event);
	const config = readConfig(db, leagueId);

	const kpis = KPI_CATALOG.map((id) => ({ id, label: KPI_LABELS[id] }));
	const members = getAllPlayers(db).map((p) => ({ id: String(p.id), name: p.name }));
	const seasons = (
		db.prepare('SELECT season_number FROM seasons WHERE league_id = ? ORDER BY season_number').all(leagueId) as {
			season_number: number;
		}[]
	).map((r) => r.season_number);
	const nextDue = Object.fromEntries(
		SECTION_IDS.map((id) => [
			id,
			nextDueAfter(config.sections[id].frequency, config.runState[id]?.lastRunAt ?? null),
		])
	);

	return json({
		kpis,
		members,
		seasons,
		runState: config.runState,
		nextDue,
	});
};