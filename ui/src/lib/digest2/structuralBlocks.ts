import type Database from 'better-sqlite3';
import { computeStandings, type StandingRow } from '$lib/db/standings.js';
import { getNextRound, type NextRoundPreview } from '$lib/db/nextRound.js';
import { getDiscoverability, type TastemakerPayload } from '$lib/db/discoverability.js';
import { getGuesserData, type GuesserData } from '$lib/db/guesserInsights.js';
import { guesserSectionEnabledFor } from '$lib/digest/guesserSection.js';
import { getActiveDraftForRound } from '$lib/digest/llm.js';

/** Parsed `digest_drafts.reel_content_json` (shapes vary by draft; read defensively). */
export interface ReelContent {
	title?: string;
	note?: string;
	media?: { src?: string; poster?: string };
}

export interface Digest2Structural {
	/** `{ standings }` wrapper (the shape StandingsChart reads), computed fresh — never the persisted "gospel" snapshot, so this path never writes. */
	standings: { standings: StandingRow[] } | null;
	nextRound: NextRoundPreview | null;
	tastemaker: TastemakerPayload | null;
	guesser: GuesserData | null;
	reel: ReelContent | null;
}

/** The read-only suppliers this module calls. Overridable in tests to inject a throw. */
export interface StructuralSuppliers {
	computeStandings: typeof computeStandings;
	getNextRound: typeof getNextRound;
	getDiscoverability: typeof getDiscoverability;
	getGuesserData: typeof getGuesserData;
	guesserSectionEnabledFor: typeof guesserSectionEnabledFor;
	getActiveDraftForRound: typeof getActiveDraftForRound;
}

const DEFAULT_SUPPLIERS: StructuralSuppliers = {
	computeStandings,
	getNextRound,
	getDiscoverability,
	getGuesserData,
	guesserSectionEnabledFor,
	getActiveDraftForRound
};

/** Run a supplier, returning `fallback` (default null) if it throws. */
function safe<T>(fn: () => T, fallback: T): T {
	try {
		return fn();
	} catch {
		return fallback;
	}
}

function leagueSlugForRound(db: Database.Database, roundId: number): string | null {
	const row = db
		.prepare(
			`SELECT l.slug AS slug
			   FROM rounds r
			   JOIN seasons s ON r.season_id = s.id
			   JOIN leagues l ON s.league_id = l.id
			  WHERE r.id = ?`
		)
		.get(roundId) as { slug?: string } | undefined;
	return row?.slug ?? null;
}

/**
 * Build the five structural/deterministic auto blocks for a round, read-only.
 * Each field is null when its block should not render (no data / not opted in /
 * excluded). Four blocks compute fresh from league.db; the Reel is reused from
 * the newest 1.0 draft's reel_content_json. A supplier that throws yields null
 * for that block only — never an exception out of this function.
 */
export function buildDigest2Structural(
	db: Database.Database,
	roundId: number,
	overrides: Partial<StructuralSuppliers> = {}
): Digest2Structural {
	const s = { ...DEFAULT_SUPPLIERS, ...overrides };

	const standings = safe<{ standings: StandingRow[] } | null>(() => {
		const rows = s.computeStandings(db, roundId); // pure; never persists (unlike getStandings)
		return rows.length > 0 ? { standings: rows } : null;
	}, null);

	const nextRound = safe<NextRoundPreview | null>(() => s.getNextRound(db, roundId) ?? null, null);

	const tastemaker = safe<TastemakerPayload | null>(() => {
		const r = s.getDiscoverability(db, roundId);
		return (r?.players?.length ?? 0) > 0 ? r : null;
	}, null);

	const guesser = safe<GuesserData | null>(() => {
		const slug = leagueSlugForRound(db, roundId);
		if (!slug || !s.guesserSectionEnabledFor(db, slug)) return null;
		const g = s.getGuesserData(db, roundId);
		return g.guesserName && g.weekly.attempts > 0 ? g : null;
	}, null);

	const reel = safe<ReelContent | null>(() => {
		const draft = s.getActiveDraftForRound(db, roundId) as
			| { reel_state?: string; reel_content_json?: string }
			| null;
		if (!draft || draft.reel_state === 'excluded') return null;
		const raw = draft.reel_content_json;
		if (!raw) return null;
		const content = JSON.parse(raw) as ReelContent;
		const hasMedia = !!(content.media?.poster || content.media?.src);
		return hasMedia ? content : null;
	}, null);

	return { standings, nextRound, tastemaker, guesser, reel };
}
