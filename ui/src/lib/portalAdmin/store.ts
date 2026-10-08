import type Database from 'better-sqlite3';
import { defaultConfig, parseConfig, type PortalAdminConfig } from './config.js';

const key = (leagueId: number) => `portal_admin_config:${leagueId}`;

/**
 * Read a league's portal-admin config. Absent → the defaults (every section
 * on, every catalog KPI selected). A row that no longer parses also yields
 * defaults rather than throwing — but it is NOT overwritten, so a bad write is
 * visible in `settings` instead of being laundered away.
 */
export function readConfig(db: Database.Database, leagueId: number): PortalAdminConfig {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key(leagueId)) as
		| { value: string }
		| undefined;
	if (!row?.value) return defaultConfig();
	try {
		return parseConfig(JSON.parse(row.value));
	} catch {
		return defaultConfig();
	}
}

export function writeConfig(db: Database.Database, leagueId: number, config: PortalAdminConfig): void {
	db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
		key(leagueId),
		JSON.stringify(config)
	);
}
