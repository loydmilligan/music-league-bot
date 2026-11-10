import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { getDigest2LeagueOptions, DIGEST2_OPTIONS_KEY } from './leagueOptions.js';

function db(options?: string) {
	const d = new Database(':memory:');
	d.exec(`CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT);
	        CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INTEGER);
	        CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INTEGER);
	        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
	        INSERT INTO leagues VALUES (1,'second-best'),(2,'boarz-ii-men');
	        INSERT INTO seasons VALUES (10,1),(20,2);
	        INSERT INTO rounds VALUES (100,10),(200,20);`);
	if (options) d.prepare('INSERT INTO settings VALUES (?,?)').run(DIGEST2_OPTIONS_KEY, options);
	return d;
}

describe('getDigest2LeagueOptions', () => {
	it('applies a league entry and leaves other leagues on defaults', () => {
		const d = db(JSON.stringify({ 'second-best': { tearForecast: false, fullFlow: true } }));
		expect(getDigest2LeagueOptions(d, 100)).toEqual({ tearForecast: false, fullFlow: true });
		expect(getDigest2LeagueOptions(d, 200)).toEqual({ tearForecast: true, fullFlow: false });
	});
	it('falls back to defaults with no row or bad JSON', () => {
		expect(getDigest2LeagueOptions(db(), 100)).toEqual({ tearForecast: true, fullFlow: false });
		expect(getDigest2LeagueOptions(db('{nope'), 100)).toEqual({ tearForecast: true, fullFlow: false });
	});
});
