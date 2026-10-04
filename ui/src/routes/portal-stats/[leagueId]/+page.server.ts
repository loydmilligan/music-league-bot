import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { buildSnapshotCached } from '$lib/server/boarzStats/data.js';
import { buildStatsNav } from '$lib/portal/statsNav.js';

export const load: PageServerLoad = async ({ params, url }) => {
	const leagueId = Number(params.leagueId);
	if (!Number.isInteger(leagueId)) error(400, 'bad league id');
	const db = getDb();
	const league = db
		.prepare(
			`SELECT l.slug, l.name FROM leagues l JOIN dashboard_sites d ON d.league_id = l.id WHERE l.id = ?`
		)
		.get(leagueId) as { slug: string; name: string } | undefined;
	if (!league) error(404, 'league not found');

	const seasonParam = url.searchParams.get('season');
	const season = seasonParam ? Number(seasonParam) : 0;
	const depth: 2 | 3 = url.searchParams.get('depth') === '3' ? 3 : 2;

	let snapshot;
	try {
		snapshot = buildSnapshotCached({ leagueSlug: league.slug, seasons: season ? [season] : undefined });
	} catch {
		error(404, 'stats unavailable');
	}
	const seasons = snapshot.league.seasons;
	const numbers = seasons.map((s) => s.number);
	const currentSeason = seasons.find((s) => s.status === 'active')?.number ?? Math.max(...numbers);
	const selectedSeason = season || currentSeason;

	return {
		share: true as const,
		snapshot,
		nav: buildStatsNav({ leagueName: league.name, depth, seasons: numbers, currentSeason, selectedSeason })
	};
};
