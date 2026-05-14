import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getLeagueBySlug, getSeasonsForLeague } from '$lib/db/leagues.js';
import { getRoundsForSeason } from '$lib/db/rounds.js';

export const load: PageServerLoad = async ({ params }) => {
	const db = getDb();
	const league = getLeagueBySlug(db, params.league);
	if (!league) throw error(404, 'League not found');
	const seasons = getSeasonsForLeague(db, league.id);
	const season = seasons.find((s) => s.seasonNumber === Number(params.n));
	if (!season) throw error(404, 'Season not found');
	const rounds = getRoundsForSeason(db, season.id).map((r) => {
		const songCount = (
			db.prepare('SELECT COUNT(*) n FROM ml_submissions WHERE round_id=?').get(r.id) as {
				n: number;
			}
		).n;
		const researchCount = (
			db.prepare('SELECT COUNT(*) n FROM research_songs WHERE round_id=?').get(r.id) as {
				n: number;
			}
		).n;
		return { ...r, songCount, researchCount };
	});
	return { league, season, rounds };
};
