import type Database from 'better-sqlite3';

// ── per-league opt-in ─────────────────────────────────────────────────────────

/**
 * Which leagues currently publish the guesser section.
 *
 * Off by default for everyone: a league gets it only after it's explicitly
 * enabled in settings.
 */
export const GUESSER_SECTION_DEFAULTS: Record<string, boolean> = {};

export const GUESSER_SETTINGS_KEY = 'guesser_section_leagues';

export function guesserSectionEnabledFor(db: Database.Database, leagueSlug: string): boolean {
	try {
		const row = db
			.prepare('SELECT value FROM settings WHERE key = ?')
			.get(GUESSER_SETTINGS_KEY) as { value?: string } | undefined;
		const saved = row?.value ? (JSON.parse(row.value) as Record<string, boolean>) : {};
		if (leagueSlug in saved) return !!saved[leagueSlug];
	} catch {
		// A malformed or missing setting falls back to the defaults rather than
		// failing the digest load.
	}
	return GUESSER_SECTION_DEFAULTS[leagueSlug] ?? false;
}

export function setGuesserSectionEnabled(
	db: Database.Database,
	leagueSlug: string,
	enabled: boolean,
): void {
	const row = db
		.prepare('SELECT value FROM settings WHERE key = ?')
		.get(GUESSER_SETTINGS_KEY) as { value?: string } | undefined;
	let saved: Record<string, boolean> = {};
	try {
		saved = row?.value ? JSON.parse(row.value) : {};
	} catch {
		saved = {};
	}
	saved[leagueSlug] = enabled;
	db.prepare(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
	).run(GUESSER_SETTINGS_KEY, JSON.stringify(saved));
}

// ── who the guesser is ────────────────────────────────────────────────────────

export const GUESSER_PLAYER_SETTINGS_KEY = 'guesser_player_by_league';

/**
 * Explicit guesser for a league, or null to fall back to "most vote comments".
 *
 * The fallback picks the chattiest voter, which is not the same person as the
 * one playing the guess-the-submitter game — in Boarz it picks Jon Black, who
 * comments most, over Matt, who actually names a submitter on every song.
 */
export function guesserPlayerOverrideFor(db: Database.Database, leagueSlug: string): number | null {
	try {
		const row = db
			.prepare('SELECT value FROM settings WHERE key = ?')
			.get(GUESSER_PLAYER_SETTINGS_KEY) as { value?: string } | undefined;
		const saved = row?.value ? (JSON.parse(row.value) as Record<string, number>) : {};
		const id = saved[leagueSlug];
		return typeof id === 'number' && Number.isInteger(id) ? id : null;
	} catch {
		// A malformed setting must not break the digest; fall back to detection.
		return null;
	}
}
