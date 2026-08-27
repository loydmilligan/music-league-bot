/**
 * The early lede sheet: a provisional, mid-round pass over what exists BEFORE
 * votes and results — submissions, their comments, the chat so far, the
 * previous round's bridge, and the editor's notes.
 *
 * Runs in-container via callOpenRouter (bot-ui has no `claude` CLI), unlike
 * the authoritative round-close run in scripts/digest-qa/generate_ledes.py.
 * The two never share storage: this writes digest_early_ledes only, so the
 * real run's "already has a row" guard is untouched and a regeneration here
 * can never clobber anything the host run produced.
 */
import type Database from 'better-sqlite3';
import { callOpenRouter, extractJsonContent } from './llm.js';
import { modelFor } from './modelFor.js';
import { notesForPrompt } from './roundNotes.js';
import { wrapNotes } from './noteEnvelope.js';
import { previousRoundId } from './prepMaterial.js';
import { getChatSettings } from '../chat/historyQuery';

export type EarlyLede = { id: string; title: string; angle: string; evidence: string[] };

export type EarlyLedeInput = {
	roundName: string;
	leagueName: string;
	songs: { title: string; artists: string; submitter: string | null }[];
	subComments: { submitter: string | null; comment: string }[];
	chat: { sender: string; text: string; ts: string }[];
	/** The previous round's bridge content_json, verbatim, or null. */
	bridge: string | null;
	/** Editor notes already wrapped in their envelope (wrapNotes), or ''. */
	notes: string;
};

export type EarlyLedeDeps = { call: typeof callOpenRouter; now: () => string; model?: string };

export function buildEarlyLedePrompt(input: EarlyLedeInput): string {
	const parts: string[] = [
		`You are drafting EARLY story ledes for the round "${input.roundName}" in the league "${input.leagueName}".`,
		'The round is still open: there are NO votes and NO results yet, and the',
		'closing stretch of chat has not happened. Do not invent outcomes, winners,',
		'or vote counts — work only from what is below.',
		'',
		'# Submissions',
		input.songs.length
			? input.songs.map((s) => `- ${s.title} — ${s.artists}${s.submitter ? ` (submitted by ${s.submitter})` : ''}`).join('\n')
			: '(none yet)',
		'',
		'# Submission comments',
		input.subComments.length
			? input.subComments.map((c) => `- ${c.submitter ?? 'unknown'}: ${c.comment}`).join('\n')
			: '(none yet)',
		'',
		'# Chat so far',
		input.chat.length
			? input.chat.map((m) => `[${m.ts}] ${m.sender}: ${m.text}`).join('\n')
			: '(none captured)',
	];
	if (input.bridge) {
		parts.push('', "# Previous round's bridge", input.bridge);
	}
	if (input.notes) {
		parts.push('', input.notes);
	}
	parts.push(
		'',
		'Return JSON: {"ledes": [{"id": string, "title": string, "angle": string, "evidence": string[]}]}',
		'3–5 ledes. Each evidence entry must point at something actually present above.',
	);
	return parts.join('\n');
}

function gatherInput(db: Database.Database, roundId: number, nowIso: string): EarlyLedeInput & { leagueId: number } {
	const round = db
		.prepare(
			`SELECT r.name AS round_name, l.id AS league_id, l.slug, l.name AS league_name
			   FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
			  WHERE r.id = ?`,
		)
		.get(roundId) as { round_name: string; league_id: number; slug: string; league_name: string } | undefined;
	if (!round) throw new Error(`round ${roundId} not found`);

	const subs = db
		.prepare(
			`SELECT m.title, m.artists, m.comment, c.name AS submitter
			   FROM ml_submissions m LEFT JOIN competitors c ON c.id = m.competitor_id
			  WHERE m.round_id = ? ORDER BY m.spotify_uri`,
		)
		.all(roundId) as { title: string; artists: string; comment: string | null; submitter: string | null }[];

	const prevId = previousRoundId(db, roundId);
	let bridge: string | null = null;
	if (prevId !== null) {
		try {
			const row = db.prepare('SELECT content_json FROM digest_bridges WHERE round_id = ?').get(prevId) as
				| { content_json: string }
				| undefined;
			bridge = row?.content_json ?? null;
		} catch {
			bridge = null; // table may not exist on an old DB
		}
	}

	// Chat window so far: previous round's end (else 7 days back) up to now.
	let chat: EarlyLedeInput['chat'] = [];
	try {
		const groupName = getChatSettings(db).leagueGroupMap[round.slug];
		if (groupName) {
			const prevEnd =
				prevId !== null
					? ((db.prepare('SELECT voting_deadline FROM rounds WHERE id = ?').get(prevId) as { voting_deadline: string | null })?.voting_deadline ?? null)
					: null;
			const fromIso = prevEnd ?? new Date(Date.parse(nowIso) - 7 * 86_400_000).toISOString();
			chat = db
				.prepare(
					`SELECT sender, text, ts FROM chat_messages
					  WHERE group_name = ? AND ts >= ? AND ts < ? ORDER BY ts ASC`,
				)
				.all(groupName, fromIso, nowIso) as EarlyLedeInput['chat'];
		}
	} catch {
		chat = []; // chat_messages is created by the relay, not schema.ts
	}

	const notes = notesForPrompt(db, roundId);
	return {
		roundName: round.round_name,
		leagueName: round.league_name,
		leagueId: round.league_id,
		songs: subs.map((s) => ({ title: s.title, artists: s.artists, submitter: s.submitter })),
		subComments: subs.filter((s) => (s.comment ?? '').trim()).map((s) => ({ submitter: s.submitter, comment: s.comment! })),
		chat,
		bridge,
		notes: wrapNotes([...notes.general, ...notes.ledes]),
	};
}

export async function generateEarlyLedes(
	db: Database.Database,
	roundId: number,
	deps: EarlyLedeDeps,
): Promise<{ ledes: EarlyLede[] }> {
	const nowIso = deps.now();
	const input = gatherInput(db, roundId, nowIso);
	const prompt = buildEarlyLedePrompt(input);

	const result = await deps.call([{ role: 'user', content: prompt }], {
		model: deps.model ?? modelFor('digest', db),
		jsonMode: true,
		meta: { category: 'digest', label: 'early-ledes', db, leagueId: input.leagueId, roundId },
	});

	let ledes: EarlyLede[];
	try {
		const parsed = JSON.parse(extractJsonContent(result.content)) as { ledes?: unknown };
		if (!Array.isArray(parsed.ledes)) throw new Error('no ledes array');
		ledes = parsed.ledes as EarlyLede[];
	} catch (e) {
		throw new Error(`early ledes: failed to parse model output: ${e instanceof Error ? e.message : e}`);
	}

	// ON CONFLICT deliberately leaves ratings_json alone: a regeneration must
	// never wipe the editor's mid-round ratings.
	db.prepare(
		`INSERT INTO digest_early_ledes (round_id, content_json, generated_at)
		 VALUES (?, ?, ?)
		 ON CONFLICT(round_id) DO UPDATE SET
		   content_json = excluded.content_json,
		   generated_at = excluded.generated_at`,
	).run(roundId, JSON.stringify({ ledes }), nowIso);

	return { ledes };
}

export function getEarlyLedes(
	db: Database.Database,
	roundId: number,
): { ledes: EarlyLede[]; ratings: unknown; generatedAt: string } | null {
	const row = db
		.prepare('SELECT content_json, ratings_json, generated_at FROM digest_early_ledes WHERE round_id = ?')
		.get(roundId) as { content_json: string; ratings_json: string | null; generated_at: string } | undefined;
	if (!row) return null;
	let ledes: EarlyLede[] = [];
	try {
		ledes = (JSON.parse(row.content_json) as { ledes?: EarlyLede[] }).ledes ?? [];
	} catch {
		ledes = [];
	}
	let ratings: unknown = null;
	if (row.ratings_json) {
		try {
			ratings = JSON.parse(row.ratings_json);
		} catch {
			ratings = null;
		}
	}
	return { ledes, ratings, generatedAt: row.generated_at };
}

/**
 * Attach the editor's ratings to an existing sheet. `nowIso` is accepted for
 * signature stability with the rest of the prep-panel API; the table carries
 * no ratings timestamp, so it is currently unused.
 */
export function saveEarlyLedeRatings(
	db: Database.Database,
	roundId: number,
	ratings: unknown,
	_nowIso: string,
): boolean {
	return (
		db.prepare('UPDATE digest_early_ledes SET ratings_json = ? WHERE round_id = ?')
			.run(JSON.stringify(ratings), roundId).changes === 1
	);
}
