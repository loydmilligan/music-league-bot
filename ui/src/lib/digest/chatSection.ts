/**
 * chatSection — the digest's chat sub-section: what window to read, what to
 * compute over it, and which visuals to show this week.
 *
 * Reads `chat_messages` rather than a WhatsApp export, because the digest runs
 * weekly and nobody is going to export their phone every Sunday. That costs us
 * edit counts (the relay cannot tell an edit from a new message) — see
 * `EXPORT_ONLY_AWARDS`.
 */

import type Database from 'better-sqlite3';
import type { Message } from './chatExport';
import { isUnknownSender } from './chatIdentity';
import { computeSuperlatives, type ChatSuperlatives, type ComputeOptions } from './chatSuperlatives';

// ── window ────────────────────────────────────────────────────────────────────

export interface ChatWindow {
	fromIso: string;
	toIso: string;
	/** Whole days the window spans, for the "last N days of chat" caption. */
	days: number;
}

/** Fall back to a week when there's no previous round to bound the start. */
const DEFAULT_WINDOW_DAYS = 7;

/**
 * The chat window for a round: from the previous round's end up to this round's
 * end, so no chat falls between two rounds and goes unreported. The first round
 * of a season has no predecessor, so it takes the seven days before its end.
 */
export function chatWindowFor(
	roundEndIso: string | null,
	previousRoundEndIso: string | null,
	windowDays = DEFAULT_WINDOW_DAYS,
): ChatWindow | null {
	if (!roundEndIso) return null;
	const end = Date.parse(roundEndIso);
	if (Number.isNaN(end)) return null;

	const prev = previousRoundEndIso ? Date.parse(previousRoundEndIso) : NaN;
	const start =
		!Number.isNaN(prev) && prev < end ? prev : end - windowDays * 86_400_000;

	return {
		fromIso: new Date(start).toISOString(),
		toIso: new Date(end).toISOString(),
		days: Math.max(1, Math.round((end - start) / 86_400_000)),
	};
}

// ── loading ───────────────────────────────────────────────────────────────────

/**
 * Relay artefacts, not chat. WhatsApp writes these when a message cannot be
 * decrypted yet; counting them would inflate message and word totals.
 */
const PLACEHOLDER_RE = /^(Waiting for this message|This message was deleted|You deleted this message)/i;
const MEDIA_RE = /\(file attached\)$/;

export interface LoadedChat {
	messages: Message[];
	/** Sender strings that matched nobody — surfaced so they can be mapped. */
	unknownSenders: string[];
	skippedPlaceholders: number;
}

/**
 * Where the group actually lives, for turning stored UTC into wall-clock time.
 *
 * `chat_messages.ts` is true UTC from the relay, but every hour-of-day metric
 * (Night Owl, the activity heatmap) is about local time. Reading UTC hours
 * directly put the group's 6pm at "01:00" and scored Grant 77% after midnight.
 * The WhatsApp export doesn't have this problem — it stores local wall clock
 * already — which is exactly why it went unnoticed on the standalone page.
 */
export const DEFAULT_CHAT_TZ = 'America/Los_Angeles';

/** Offset in minutes to add to UTC to get local time, honouring DST. */
export function tzOffsetMinutes(at: Date, timeZone: string): number {
	// Formatting the same instant in the zone and in UTC and diffing them is the
	// only DST-correct way to do this without a tz library.
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
	});
	const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
	const asUtc = Date.UTC(
		Number(p.year), Number(p.month) - 1, Number(p.day),
		Number(p.hour) % 24, Number(p.minute), Number(p.second),
	);
	return Math.round((asUtc - at.getTime()) / 60_000);
}

export function loadChatWindow(
	db: Database.Database,
	groupName: string,
	window: ChatWindow,
	timeZone = DEFAULT_CHAT_TZ,
): LoadedChat {
	const rows = db
		.prepare(
			`SELECT sender, text, ts FROM chat_messages
			  WHERE group_name = ? AND ts >= ? AND ts < ?
			  ORDER BY ts ASC`,
		)
		.all(groupName, window.fromIso, window.toIso) as { sender: string; text: string; ts: string }[];

	const messages: Message[] = [];
	const unknown = new Set<string>();
	let skipped = 0;

	for (const r of rows) {
		const text = (r.text ?? '').trim();
		if (!text || PLACEHOLDER_RE.test(text)) {
			skipped++;
			continue;
		}
		if (isUnknownSender(r.sender)) unknown.add(r.sender);
		const utc = Date.parse(r.ts);
		if (Number.isNaN(utc)) continue;
		// Shift to local wall clock so getUTCHours()/getUTCDay() downstream read as
		// local hour and weekday — matching what the export path already produces.
		const ts = utc + tzOffsetMinutes(new Date(utc), timeZone) * 60_000;
		messages.push({
			sender: r.sender,
			ts,
			text,
			// The relay cannot flag edits; only the export can.
			edited: false,
			media: MEDIA_RE.test(text) ? text : null,
			mentions: [],
		});
	}

	return { messages, unknownSenders: [...unknown], skippedPlaceholders: skipped };
}

// ── rotation ──────────────────────────────────────────────────────────────────

export const CHARTS = ['mixingBoard', 'heatmap'] as const;
export type ChartId = (typeof CHARTS)[number];

export const FEATURES = ['biggestWord', 'longestWords', 'triptych', 'trackList'] as const;
export type FeatureId = (typeof FEATURES)[number];

/**
 * Awards that can only be computed from a WhatsApp export, so they must never
 * be offered in the weekly rotation.
 */
export const EXPORT_ONLY_AWARDS = new Set(['perfectionist']);

/** Award pool for the superlatives strip, in rotation order. */
export const AWARD_POOL = [
	'motormouth',
	'linguist',
	'vocabulary',
	'explicit',
	'professor',
	'nightOwl',
	'lurker',
	'wordsmith',
	'variety',
	'rambler',
	'simplest',
	'linker',
] as const;

export interface Rotation {
	chart: ChartId;
	feature: FeatureId;
	awards: string[];
}

/**
 * Pick this week's visuals from the round number.
 *
 * Deriving rotation from the round rather than storing a cursor keeps it
 * reproducible: regenerating a digest, or rebuilding an old one, always yields
 * the same layout instead of advancing a counter.
 */
export function rotationFor(roundNumber: number, awardCount = 4): Rotation {
	const n = Math.max(0, Math.floor(roundNumber));
	const awards: string[] = [];
	for (let i = 0; i < awardCount; i++) {
		awards.push(AWARD_POOL[(n * awardCount + i) % AWARD_POOL.length]);
	}
	return {
		chart: CHARTS[n % CHARTS.length],
		feature: FEATURES[n % FEATURES.length],
		awards,
	};
}

// ── assembly ──────────────────────────────────────────────────────────────────

export interface ChatSectionData {
	window: ChatWindow;
	groupName: string;
	messageCount: number;
	participantCount: number;
	stats: ChatSuperlatives;
	rotation: Rotation;
	/** Awards actually resolvable this week, in rotation order. */
	awards: { key: string; person: string; value: string; caption: string }[];
	unknownSenders: string[];
	/** Too little chat in the window to be worth showing at all. */
	tooQuiet: boolean;
}

/** Below this the section is noise, not content. */
export const MIN_MESSAGES_FOR_SECTION = 40;

// ── word lists ────────────────────────────────────────────────────────────────

/**
 * Frequency list and dictionary, bundled rather than read from the system.
 *
 * The standalone page used /usr/share/dict/words, which does not exist in the
 * production container — the language awards would have silently scored zero
 * for everyone. Shipping the lists makes the digest reproducible anywhere.
 * The dictionary is trimmed to 7+ letters because every word it gates on
 * (3+ syllables) is longer than that.
 */
let wordLists: { dictionary: Set<string>; commonWords: string[] } | null = null;

export function loadWordLists(): { dictionary: Set<string>; commonWords: string[] } {
	if (wordLists) return wordLists;
	// Lazy require keeps this out of any browser bundle.
	const fs = require('node:fs') as typeof import('node:fs');
	const path = require('node:path') as typeof import('node:path');
	const here = path.dirname(new URL(import.meta.url).pathname);
	const read = (f: string) =>
		fs
			.readFileSync(path.join(here, f), 'utf8')
			.split('\n')
			.map((w) => w.trim())
			.filter(Boolean);
	wordLists = {
		dictionary: new Set(read('long-words.txt')),
		commonWords: read('common-words.txt'),
	};
	return wordLists;
}

// ── recommendations ───────────────────────────────────────────────────────────

export type PartId = 'linerNotes' | 'chart' | 'feature' | 'superlatives';

export interface PartRecommendation {
	part: PartId;
	include: boolean;
	reason: string;
}

/**
 * Suggest which parts to keep this week, given what last week looked like.
 *
 * The rotation already guarantees the chart and feature visual differ from last
 * round, so the thing worth flagging is repetition of *people*: an award whose
 * winner hasn't changed reads as a rerun even though the underlying number is
 * fresh. Recommendations are advisory — the toggles stay the human's call.
 */
export function recommendParts(
	current: ChatSectionData,
	previous?: ChatSectionData | null,
	hasLinerNotes = true,
): PartRecommendation[] {
	if (current.tooQuiet) {
		const reason = `Only ${current.messageCount} messages in this window — not enough chat to be worth a section.`;
		return (['linerNotes', 'chart', 'feature', 'superlatives'] as PartId[]).map((part) => ({
			part,
			include: false,
			reason,
		}));
	}

	const repeats = previous
		? current.awards.filter((a) => {
				const before = previous.awards.find((p) => p.key === a.key);
				return before && before.person === a.person;
			})
		: [];

	return [
		{
			part: 'linerNotes',
			include: hasLinerNotes,
			reason: hasLinerNotes
				? 'Chat summaries generated for this round.'
				: 'No chat summaries were generated for this round.',
		},
		{
			part: 'chart',
			include: true,
			reason: `Rotation picked the ${current.rotation.chart === 'heatmap' ? 'activity heatmap' : 'mixing board'}; last round showed the other one.`,
		},
		{
			part: 'feature',
			include: true,
			reason: `Rotation picked ${current.rotation.feature}, which last appeared ${FEATURES.length} rounds ago.`,
		},
		{
			part: 'superlatives',
			include: repeats.length < current.awards.length,
			reason: repeats.length
				? `${repeats.map((r) => `${r.person} wins ${r.key} again`).join('; ')} — consider cutting the repeats.`
				: 'All winners changed since last round.',
		},
	];
}

export function buildChatSection(
	db: Database.Database,
	opts: {
		groupName: string;
		roundNumber: number;
		roundEndIso: string | null;
		previousRoundEndIso: string | null;
		awardCount?: number;
		compute?: ComputeOptions;
	},
): ChatSectionData | null {
	const window = chatWindowFor(opts.roundEndIso, opts.previousRoundEndIso);
	if (!window) return null;

	const { messages, unknownSenders } = loadChatWindow(db, opts.groupName, window);

	const lists = loadWordLists();
	const stats = computeSuperlatives(messages, [], {
		// A single round is a much smaller corpus than a whole season, so the
		// variety sample has to come down with it or nobody qualifies.
		vocabSample: 200,
		minMessages: 15,
		minWords: 150,
		dictionary: lists.dictionary,
		commonWords: lists.commonWords,
		commonCutoff: 1000,
		...opts.compute,
	});

	const rotation = rotationFor(opts.roundNumber, opts.awardCount ?? 4);

	const awards = rotation.awards
		.filter((k) => !EXPORT_ONLY_AWARDS.has(k))
		.map((key) => {
			const a = stats.awards[key];
			return a ? { key, ...a } : null;
		})
		.filter((a): a is { key: string; person: string; value: string; caption: string } => !!a);

	return {
		window,
		groupName: opts.groupName,
		messageCount: messages.length,
		participantCount: stats.people.length,
		stats,
		rotation,
		awards,
		unknownSenders,
		tooQuiet: messages.length < MIN_MESSAGES_FOR_SECTION,
	};
}
