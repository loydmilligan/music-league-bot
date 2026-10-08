// Portal admin — shared season→plan sync. All task endpoints derrive the active
// (or latest) season's plan before reading, so stored rows always reflect the
// current round schedule. Returns the season number, or null when the league
// has no seasons yet.
import type Database from 'better-sqlite3';
import { getActiveSeasonId } from '$lib/db/activeRound.js';
import { getRoundsForSeason } from '$lib/db/rounds.js';
import { deriveSeason } from './taskStore.js';
import type { Season } from '../types.js';

export function syncSeasonPlan(db: Database.Database, leagueId: number): number | null {
	const active = getActiveSeasonId(db, leagueId);
	const latest = db
		.prepare('SELECT id FROM seasons WHERE league_id = ? ORDER BY id DESC LIMIT 1')
		.get(leagueId) as { id: number } | undefined;
	const seasonId = active ?? latest?.id;
	if (!seasonId) return null;
	const row = db
		.prepare('SELECT id, league_id, season_number, status FROM seasons WHERE id = ?')
		.get(seasonId) as { id: number; league_id: number; season_number: number; status: string } | undefined;
	if (!row) return null;
	const season: Season = {
		id: row.id,
		leagueId: row.league_id,
		seasonNumber: row.season_number,
		status: row.status as Season['status'],
	};
	deriveSeason(db, season, getRoundsForSeason(db, row.id));
	return season.seasonNumber;
}