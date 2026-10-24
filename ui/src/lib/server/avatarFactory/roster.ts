import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { BOARZ_PLAYER_IDS, BOARZ_SEASON_NUMBER } from './notes.js';
import { slugify } from './filenames.js';

export interface RosterMember {
	playerId: number | null;
	name: string;
	slug: string;
}

export interface RosterLeague {
	id: number;
	slug: string;
	name: string;
	seasonNumber: number;
	members: RosterMember[];
}

function leagueDbPath(): string {
	const dataDir = process.env.DATA_DIR ?? resolve(process.cwd(), '../data');
	return resolve(dataDir, 'league.db');
}

/** Read-only SELECT. Never writes. Does not run schema migrations. */
export function listLeaguesReadonly(dbPath = leagueDbPath()): { slug: string; name: string }[] {
	if (!existsSync(dbPath)) return [];
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	try {
		const rows = db.prepare('SELECT slug, name FROM leagues ORDER BY id').all() as { slug: string; name: string }[];
		return rows;
	} finally {
		db.close();
	}
}

export function readRoster(leagueSlug: string, dbPath = leagueDbPath()): RosterLeague | null {
	if (!existsSync(dbPath)) return null;
	const db = new Database(dbPath, { readonly: true, fileMustExist: true });
	try {
		const league = db.prepare('SELECT id, slug, name FROM leagues WHERE slug = ?').get(leagueSlug) as
			| { id: number; slug: string; name: string }
			| undefined;
		if (!league) return null;

		const season = db
			.prepare(
				`SELECT id, season_number FROM seasons WHERE league_id = ? ORDER BY season_number DESC LIMIT 1`,
			)
			.get(league.id) as { id: number; season_number: number } | undefined;
		if (!season) {
			return { id: league.id, slug: league.slug, name: league.name, seasonNumber: 0, members: [] };
		}

		const rows = db
			.prepare(
				`SELECT p.id, p.name
         FROM season_players sp
         JOIN players p ON p.id = sp.player_id
         WHERE sp.season_id = ?
         ORDER BY p.name`,
			)
			.all(season.id) as { id: number; name: string }[];

		const members: RosterMember[] = rows.map((r) => ({
			playerId: r.id,
			name: r.name,
			slug: BOARZ_PLAYER_IDS[r.id] ?? slugify(r.name),
		}));

		return {
			id: league.id,
			slug: league.slug,
			name: league.name,
			seasonNumber: season.season_number,
			members,
		};
	} finally {
		db.close();
	}
}

export function preferredBoarzSeason(roster: RosterLeague | null): number {
	if (!roster) return BOARZ_SEASON_NUMBER;
	return roster.seasonNumber || BOARZ_SEASON_NUMBER;
}
