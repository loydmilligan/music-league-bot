import type Database from 'better-sqlite3';
import { mintSlug } from './slug.js';
import { buildReadModel } from './buildReadModel.js';

interface DashboardSiteRow {
	slug: string;
}

export async function publishSite(
	db: Database.Database,
	leagueId: number,
): Promise<{ slug: string }> {
	const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId) as
		| { id: number }
		| undefined;
	if (!league) throw new Error(`League ${leagueId} not found`);

	// Reuse existing slug if already published, otherwise mint a new one
	const existing = db
		.prepare('SELECT slug FROM dashboard_sites WHERE league_id = ?')
		.get(leagueId) as DashboardSiteRow | undefined;
	const slug = existing?.slug ?? mintSlug();

	const readModel = await buildReadModel(db, leagueId, { slug });
	const now = new Date().toISOString();

	if (existing) {
		db.prepare(
			`UPDATE dashboard_sites
			 SET read_model = ?, archived_rounds = ?, season = ?, refreshed_at = ?
			 WHERE league_id = ?`,
		).run(
			JSON.stringify(readModel),
			JSON.stringify(readModel.archive),
			readModel.league.season,
			now,
			leagueId,
		);
	} else {
		db.prepare(
			`INSERT INTO dashboard_sites
			 (slug, league_id, season, read_model, archived_rounds, is_live, published_at, refreshed_at)
			 VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
		).run(
			slug,
			leagueId,
			readModel.league.season,
			JSON.stringify(readModel),
			JSON.stringify(readModel.archive),
			now,
			now,
		);
	}

	return { slug };
}
