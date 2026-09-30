import type Database from 'better-sqlite3';
import type { StatsSelection } from '$lib/server/boarzStats/data.js';

/**
 * Map a round id to the read-only Boarz-stats selection for its OWN season.
 * Returns null if the round does not exist.
 */
export function resolveStatsSelectionForRound(
	db: Database.Database,
	roundId: number
): StatsSelection | null {
	const row = db
		.prepare(
			`SELECT l.slug AS leagueSlug, s.season_number AS seasonNumber
			   FROM rounds r
			   JOIN seasons s ON s.id = r.season_id
			   JOIN leagues l ON l.id = s.league_id
			  WHERE r.id = ?`
		)
		.get(roundId) as { leagueSlug: string; seasonNumber: number } | undefined;
	if (!row) return null;
	return { leagueSlug: row.leagueSlug, seasons: [row.seasonNumber] };
}
