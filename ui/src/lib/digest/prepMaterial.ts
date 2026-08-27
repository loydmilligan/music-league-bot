/**
 * What pre-generation material exists for a round.
 *
 * Answers a different question from runPrepChecks: that one asks "is the DATA
 * imported?", this asks "what MATERIAL do we hold to build from?" They render
 * as two blocks on the prepare stage and are deliberately not merged.
 */
import type Database from 'better-sqlite3';
import { chatWindowFor, loadChatWindow, chatSectionEnabledFor } from './chatSection.js';
import { getChatSettings } from '../chat/historyQuery.js';
import { guesserSectionEnabledFor } from './guesserSection.js';
import { gatherStorylineEvidence } from './storylineEvidence.js';
import { getGuesserData } from '../db/guesserInsights.js';

/**
 * `not-enabled` (the league is not opted in) is deliberately distinct from
 * `absent` (opted in, nothing there). Collapsing them is how R148 shipped
 * without a Regulars section without anyone noticing.
 */
export type MaterialStatus = 'present' | 'absent' | 'not-enabled';

export type MaterialRow = {
	id: string;
	name: string;
	status: MaterialStatus;
	/** Where it comes from / why it is missing. Rendered like PrepareCheck.src. */
	src: string;
	count?: number;
	preview?: unknown;
};

/**
 * The prior round in the same season, by voting deadline.
 * Mirrors generate_ledes.py's lookup so the app and the lede generator never
 * disagree about which bridge belongs to which round.
 */
export function previousRoundId(db: Database.Database, roundId: number): number | null {
	const self = db.prepare('SELECT season_id, voting_deadline FROM rounds WHERE id = ?')
		.get(roundId) as { season_id: number; voting_deadline: string | null } | undefined;
	if (!self?.voting_deadline) return null;
	const prev = db.prepare(
		`SELECT id FROM rounds
      WHERE season_id = ? AND voting_deadline IS NOT NULL AND voting_deadline < ?
      ORDER BY voting_deadline DESC LIMIT 1`,
	).get(self.season_id, self.voting_deadline) as { id: number } | undefined;
	return prev?.id ?? null;
}

function bridgeRow(db: Database.Database, roundId: number): MaterialRow {
	const base = { id: 'bridge', name: "Previous round's bridge" };
	const prevId = previousRoundId(db, roundId);
	if (prevId === null) {
		return { ...base, status: 'absent', src: 'no previous round in this season' };
	}
	let row: { content_json: string; generated_at: string } | undefined;
	try {
		row = db.prepare('SELECT content_json, generated_at FROM digest_bridges WHERE round_id = ?')
			.get(prevId) as typeof row;
	} catch {
		row = undefined; // table may not exist on an old DB
	}
	if (!row) {
		return { ...base, status: 'absent', src: `digest_bridges · round ${prevId} · never generated` };
	}
	try {
		return {
			...base,
			status: 'present',
			src: `round ${prevId} · ${row.generated_at}`,
			preview: JSON.parse(row.content_json),
		};
	} catch {
		// A malformed payload is worse than a missing one; report it as absent so
		// it is regenerated rather than silently previewed as empty.
		return { ...base, status: 'absent', src: `round ${prevId} · malformed payload` };
	}
}

/** The round's league slug, or null if the round/league chain doesn't resolve. */
function leagueSlugForRound(db: Database.Database, roundId: number): string | null {
	const row = db
		.prepare(
			`SELECT l.slug AS slug
			   FROM rounds r
			   JOIN seasons s ON s.id = r.season_id
			   JOIN leagues l ON l.id = s.league_id
			  WHERE r.id = ?`,
		)
		.get(roundId) as { slug: string } | undefined;
	return row?.slug ?? null;
}

function earlyLedesRow(db: Database.Database, roundId: number): MaterialRow {
	const base = { id: 'early-ledes', name: 'Early lede sheet' };
	const row = db
		.prepare('SELECT content_json, generated_at FROM digest_early_ledes WHERE round_id = ?')
		.get(roundId) as { content_json: string; generated_at: string } | undefined;
	if (!row) {
		return { ...base, status: 'absent', src: `digest_early_ledes · round ${roundId} · never drafted` };
	}
	try {
		return {
			...base,
			status: 'present',
			src: `round ${roundId} · ${row.generated_at}`,
			preview: JSON.parse(row.content_json),
		};
	} catch {
		return { ...base, status: 'absent', src: `round ${roundId} · malformed payload` };
	}
}

function chatRow(db: Database.Database, roundId: number): MaterialRow {
	const base = { id: 'chat', name: 'Chat window' };
	const slug = leagueSlugForRound(db, roundId);
	if (!slug) {
		return { ...base, status: 'absent', src: 'round has no resolvable league' };
	}
	if (!chatSectionEnabledFor(db, slug)) {
		return { ...base, status: 'not-enabled', src: `chat section not enabled for ${slug}` };
	}
	const groupName = getChatSettings(db).leagueGroupMap[slug] ?? '';
	if (!groupName) {
		return { ...base, status: 'absent', src: `no chat group linked for ${slug}` };
	}
	const round = db.prepare('SELECT voting_deadline FROM rounds WHERE id = ?').get(roundId) as
		| { voting_deadline: string | null }
		| undefined;
	const prevId = previousRoundId(db, roundId);
	const prev = prevId
		? (db.prepare('SELECT voting_deadline FROM rounds WHERE id = ?').get(prevId) as
				| { voting_deadline: string | null }
				| undefined)
		: undefined;
	const window = chatWindowFor(round?.voting_deadline ?? null, prev?.voting_deadline ?? null);
	if (!window) {
		return { ...base, status: 'absent', src: 'round has no voting deadline to bound the window' };
	}
	const { messages } = loadChatWindow(db, groupName, window);
	if (messages.length === 0) {
		return { ...base, status: 'absent', src: `${groupName} · no messages in window` };
	}
	return {
		...base,
		status: 'present',
		src: `${groupName} · ${window.fromIso} – ${window.toIso}`,
		count: messages.length,
	};
}

function storylinesRow(db: Database.Database, roundId: number): MaterialRow {
	const base = { id: 'storylines', name: 'The Regulars evidence' };
	const slug = leagueSlugForRound(db, roundId);
	if (!slug) {
		return { ...base, status: 'absent', src: 'round has no resolvable league' };
	}
	const row = db.prepare("SELECT value FROM settings WHERE key = 'storylines_section_leagues'").get() as
		| { value?: string }
		| undefined;
	let enabled = false;
	try {
		const saved = row?.value ? JSON.parse(row.value) : undefined;
		if (Array.isArray(saved)) enabled = saved.includes(slug);
		else if (saved && typeof saved === 'object') enabled = !!(saved as Record<string, boolean>)[slug];
	} catch {
		enabled = false;
	}
	if (!enabled) {
		return { ...base, status: 'not-enabled', src: `storylines not enabled for ${slug}` };
	}
	const evidence = gatherStorylineEvidence(db, roundId);
	if (evidence.length === 0) {
		return { ...base, status: 'absent', src: `${slug} · no matching evidence this round` };
	}
	return {
		...base,
		status: 'present',
		src: `${slug} · ${evidence.length} storyline${evidence.length === 1 ? '' : 's'}`,
		count: evidence.length,
		preview: evidence,
	};
}

function guesserRow(db: Database.Database, roundId: number): MaterialRow {
	const base = { id: 'guesser', name: 'The Guesser' };
	const slug = leagueSlugForRound(db, roundId);
	if (!slug) {
		return { ...base, status: 'absent', src: 'round has no resolvable league' };
	}
	if (!guesserSectionEnabledFor(db, slug)) {
		return { ...base, status: 'not-enabled', src: `guesser section not enabled for ${slug}` };
	}
	const data = getGuesserData(db, roundId);
	if (!data.guesserName) {
		return { ...base, status: 'absent', src: `${slug} · no detectable guesser yet` };
	}
	return {
		...base,
		status: 'present',
		src: `${slug} · ${data.guesserName} · ${data.weekly.attempts} guess${data.weekly.attempts === 1 ? '' : 'es'} this round`,
		count: data.weekly.attempts,
		preview: data,
	};
}

function participationRow(db: Database.Database, roundId: number): MaterialRow {
	const base = { id: 'participation', name: 'Participation' };
	const row = db
		.prepare('SELECT COUNT(*) AS n FROM player_participation WHERE round_id = ?')
		.get(roundId) as { n: number };
	if (!row.n) {
		return { ...base, status: 'absent', src: `player_participation · round ${roundId} · never computed` };
	}
	return {
		...base,
		status: 'present',
		src: `player_participation · round ${roundId} · ${row.n} vector${row.n === 1 ? '' : 's'}`,
		count: row.n,
	};
}

function safeRow(id: string, name: string, build: () => MaterialRow): MaterialRow {
	try {
		return build();
	} catch (e) {
		return { id, name, status: 'absent', src: `unavailable: ${e instanceof Error ? e.message : String(e)}` };
	}
}

export function gatherPrepMaterial(db: Database.Database, roundId: number): MaterialRow[] {
	return [
		safeRow('bridge', "Previous round's bridge", () => bridgeRow(db, roundId)),
		safeRow('early-ledes', 'Early lede sheet', () => earlyLedesRow(db, roundId)),
		safeRow('chat', 'Chat window', () => chatRow(db, roundId)),
		safeRow('storylines', 'The Regulars evidence', () => storylinesRow(db, roundId)),
		safeRow('guesser', 'The Guesser', () => guesserRow(db, roundId)),
		safeRow('participation', 'Participation', () => participationRow(db, roundId)),
	];
}
