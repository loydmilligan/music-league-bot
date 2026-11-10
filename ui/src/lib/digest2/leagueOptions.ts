import type Database from 'better-sqlite3';

/**
 * Per-league switches for the digest 2.0 page, stored as JSON in
 * settings.digest2_league_options, e.g. {"second-best": {"tearForecast": false, "fullFlow": true}}.
 * Leagues not listed get the defaults. No UI yet: edit the settings row.
 */
export interface Digest2LeagueOptions {
	/** Show the 😂 Tear Forecast card in the chat stats. */
	tearForecast: boolean;
	/** Show every paragraph of the 1.0 "What Went Down" (flow) text above How It Played, not just the first. */
	fullFlow: boolean;
}

export const DIGEST2_OPTIONS_KEY = 'digest2_league_options';
const DEFAULTS: Digest2LeagueOptions = { tearForecast: true, fullFlow: false };

export function getDigest2LeagueOptions(db: Database.Database, roundId: number): Digest2LeagueOptions {
	try {
		const slug = (
			db
				.prepare(
					`SELECT l.slug FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id WHERE r.id = ?`
				)
				.get(roundId) as { slug: string } | undefined
		)?.slug;
		const raw = (db.prepare('SELECT value FROM settings WHERE key = ?').get(DIGEST2_OPTIONS_KEY) as { value?: string } | undefined)?.value;
		const all = JSON.parse(raw ?? '{}') as Record<string, Partial<Digest2LeagueOptions>>;
		const mine = slug ? all[slug] ?? {} : {};
		return {
			tearForecast: typeof mine.tearForecast === 'boolean' ? mine.tearForecast : DEFAULTS.tearForecast,
			fullFlow: typeof mine.fullFlow === 'boolean' ? mine.fullFlow : DEFAULTS.fullFlow,
		};
	} catch {
		return { ...DEFAULTS };
	}
}
