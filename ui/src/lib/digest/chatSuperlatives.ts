/**
 * chatSuperlatives — person-level stats mined from a group chat.
 *
 * Pure and synchronous: no filesystem, no DB, no clock. Everything it needs
 * arrives as arguments so every metric is testable against fixtures.
 */

import type { Message } from './chatExport';
import { resolveSender, type Person } from './chatIdentity';

// ── inputs ────────────────────────────────────────────────────────────────────

export interface VoteComment {
	/** Canonical person name. */
	person: string;
	comment: string;
}

/** Everyone who cast a ballot, whether or not they left any comment. */
export type Voters = Set<string>;

export interface ComputeOptions {
	/** Lowercase dictionary, for THE BIGGEST WORD. Without it, that award is null. */
	dictionary?: Set<string>;
	/**
	 * The N most common English words, most-frequent first. Anything outside this
	 * set counts as a "rare" word. Without it, rareWords is 0 for everyone.
	 */
	commonWords?: string[];
	/** How many of the commonWords list count as "common". */
	commonCutoff?: number;
	/** Minimum tokens required to score vocabulary richness. */
	vocabFloor?: number;
	/** Token sample size for the standardized type-token ratio. */
	vocabSample?: number;
	/** Deterministic seed so repeated runs produce identical output. */
	seed?: number;
}

// ── outputs ───────────────────────────────────────────────────────────────────

export interface PersonStats {
	name: string;
	rookie: boolean;
	messages: number;
	words: number;
	characters: number;
	edits: number;
	links: number;
	emoji: number;
	mediaShared: number;
	swears: number;
	/** Swears per 1,000 words, raw. */
	swearRate: number;
	/** Swear rate shrunk toward the group mean by sample size. See `shrink`. */
	swearRateAdj: number;
	topSwear: string | null;
	/** Standardized type-token ratio ×100, or null below the floor. */
	vocabulary: number | null;
	uniqueWords: number;
	/**
	 * Share of words with 3+ syllables, as a percentage. The "complex words"
	 * component of Gunning Fog.
	 *
	 * Replaces Flesch-Kincaid, which was removed: FK is 2/3 driven by
	 * words-per-sentence, and chat messages mostly lack terminal punctuation, so
	 * it silently measured punctuation habits. Two people writing identically
	 * long messages scored 1.4 grades apart purely because one used periods.
	 * A rate over words has no such dependency.
	 */
	complexWords: number;
	/** Complex-word rate shrunk toward the group mean by sample size. */
	complexWordsAdj: number;
	/** Share of words outside the N most common English words, as a percentage. */
	rareWords: number;
	/** Rare-word rate shrunk toward the group mean by sample size. */
	rareWordsAdj: number;
	avgWordsPerMessage: number;
	longestMessage: { chars: number; text: string; ts: number } | null;
	/** Median minutes to reply, counting only replies within 10 minutes.
	 *  Export timestamps are minute-resolution, so this quantises hard. */
	medianReplyMinutes: number | null;
	/** Share of their replies that landed within a minute. The usable
	 *  responsiveness measure given minute-resolution timestamps. */
	snapBackRate: number;
	replies: number;
	/** Circular-mean posting hour, 0–23. */
	meanHour: number;
	/** Share of messages posted between 00:00 and 04:59. */
	lateNightShare: number;
	/** 7×24 grid, [dayOfWeek][hour]. */
	heatmap: number[][];
	/** Did they cast a ballot at all? */
	voted: boolean;
	voteCommentWords: number | null;
	/**
	 * Chat words ÷ vote-comment words.
	 * `Infinity` when they voted but never left a single comment — the extreme
	 * case, not missing data. `null` when they never voted (rookies), which is
	 * genuinely not measurable.
	 *
	 * NOTE: JSON.stringify serialises Infinity as null, which is indistinguishable
	 * from "never voted". Consumers reading serialised output must branch on
	 * `silentVoter` first.
	 */
	talkToBallot: number | null;
	/** Voted, but wrote zero comment words — a talk-to-ballot ratio of ∞. */
	silentVoter: boolean;
}

export interface BigWord {
	word: string;
	person: string;
	quote: string;
	ts: number;
}

export interface ChatSuperlatives {
	generatedFrom: { messages: number; from: number; to: number; days: number };
	people: PersonStats[];
	biggestWords: BigWord[];
	awards: Record<string, { person: string; value: string; caption: string } | null>;
	notes: string[];
}

// ── text helpers ──────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/\S+/g;
// Letters plus internal apostrophes; curly and straight both accepted.
const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const SWEARS = [
	'fuck', 'fucking', 'fucked', 'fucker', 'fuckin', 'motherfucker',
	'shit', 'shitty', 'shitting', 'bullshit', 'shithead',
	'ass', 'asshole', 'jackass', 'dumbass', 'badass',
	'bitch', 'bitches', 'bitching',
	'damn', 'goddamn', 'dammit',
	'hell',
	'bastard',
	'dick', 'dickhead', 'cock',
	'piss', 'pissed',
	'crap', 'crappy',
	'cunt',
	'twat',
	'prick',
	'wanker',
	'bollocks',
	'balls',
	'tits', 'titties',
	'slut', 'whore',
	'douche', 'douchebag',
];
const SWEAR_SET = new Set(SWEARS);

/** Strip URLs and media filenames — neither is prose. */
export function prose(m: Message): string {
	if (m.media) return '';
	return m.text.replace(URL_RE, ' ');
}

export function words(text: string): string[] {
	return text.match(WORD_RE) ?? [];
}

/**
 * Syllable count, heuristic. Good enough for Flesch-Kincaid on chat text,
 * which is itself a blunt instrument — see the spec.
 */
export function syllables(word: string): number {
	const w = word.toLowerCase().replace(/[^a-z]/g, '');
	if (!w) return 0;
	if (w.length <= 3) return 1;

	let s = w
		.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
		.replace(/^y/, '')
		.match(/[aeiouy]{1,2}/g);

	return Math.max(1, s ? s.length : 1);
}

/**
 * Pull a rate toward the group mean in proportion to how little evidence backs
 * it (empirical-Bayes shrinkage).
 *
 * Raw rates look volume-neutral but are not: on this corpus, complex-word and
 * rare-word rates correlate -0.45 and -0.51 with log(total words). Two forces
 * cause that. People who talk more pad with filler ("lol", "yeah"), which
 * genuinely dilutes their rate; and small samples produce extreme values by
 * chance, so the top of any raw leaderboard fills up with the people whose
 * numbers are least trustworthy. Dave Steingart's 8.84% over 430 words carries
 * a 95% interval of ±2.42 — it overlaps the group average.
 *
 * Shrinking fixes the second force without inverting the first: a person with
 * plenty of words keeps their number, a person with few is pulled toward the
 * middle, and anyone can still win outright if their signal is strong enough to
 * survive it. High volume is not rewarded either — an average rate over 6,000
 * words stays average.
 *
 * @param k word count at which a person sits halfway between their own rate and
 *          the group mean.
 */
export function shrink(rate: number, words: number, groupMean: number, k = 1000): number {
	if (words <= 0) return groupMean;
	return (words * rate + k * groupMean) / (words + k);
}

/** Deterministic PRNG so the vocabulary sample is reproducible. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Standardized type-token ratio: unique words in a fixed-size random sample,
 * averaged over several draws. Raw unique-word count is a proxy for volume —
 * it would hand this award to whoever talks most, which is a different award.
 */
export function standardizedTTR(
	tokens: string[],
	sampleSize: number,
	draws: number,
	rand: () => number,
): number | null {
	if (tokens.length < sampleSize) return null;

	let total = 0;
	for (let d = 0; d < draws; d++) {
		const pool = tokens.slice();
		const seen = new Set<string>();
		for (let i = 0; i < sampleSize; i++) {
			const j = i + Math.floor(rand() * (pool.length - i));
			[pool[i], pool[j]] = [pool[j], pool[i]];
			seen.add(pool[i]);
		}
		total += seen.size / sampleSize;
	}
	return (total / draws) * 100;
}

/** Elongations ("aaaahhhh") and keysmashes are not vocabulary. */
function isPlausibleWord(w: string): boolean {
	if (w.length < 4) return false;
	if (/(.)\1\1/.test(w)) return false;
	return new Set(w).size >= 3;
}

function median(xs: number[]): number | null {
	if (xs.length === 0) return null;
	const s = xs.slice().sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Hours are circular: 23:00 and 01:00 average to midnight, not noon. */
function circularMeanHour(hours: number[]): number {
	if (hours.length === 0) return 0;
	let x = 0;
	let y = 0;
	for (const h of hours) {
		const a = (h / 24) * 2 * Math.PI;
		x += Math.cos(a);
		y += Math.sin(a);
	}
	const mean = Math.atan2(y / hours.length, x / hours.length);
	const h = (mean / (2 * Math.PI)) * 24;
	return (h + 24) % 24;
}

// ── main ──────────────────────────────────────────────────────────────────────

export function computeSuperlatives(
	messages: Message[],
	voteComments: VoteComment[] = [],
	opts: ComputeOptions = {},
	voters: Voters = new Set(voteComments.map((v) => v.person)),
): ChatSuperlatives {
	// 400 tokens, not 1500: at 1500 half the group falls below the floor and
	// gets "insufficient sample", which defeats the point of a full-field chart.
	// A 400-token standardized TTR is noisier but still comparable across people.
	const { dictionary, vocabSample = 400, seed = 20260727, commonWords, commonCutoff = 1000 } = opts;
	const rand = mulberry32(seed);
	const notes: string[] = [];
	const commonSet = commonWords ? new Set(commonWords.slice(0, commonCutoff)) : null;

	interface Acc {
		person: Person;
		messages: number;
		words: number;
		characters: number;
		edits: number;
		links: number;
		emoji: number;
		mediaShared: number;
		swearCounts: Map<string, number>;
		tokens: string[];
		unique: Set<string>;
		syllables: number;
		complex: number;
		rare: number;
		longest: { chars: number; text: string; ts: number } | null;
		hours: number[];
		heatmap: number[][];
		replyGaps: number[];
	}

	const acc = new Map<string, Acc>();
	const ensure = (p: Person): Acc => {
		let a = acc.get(p.name);
		if (!a) {
			a = {
				person: p,
				messages: 0, words: 0, characters: 0, edits: 0, links: 0,
				emoji: 0, mediaShared: 0,
				swearCounts: new Map(), tokens: [], unique: new Set(),
				syllables: 0, complex: 0, rare: 0, longest: null, hours: [],
				heatmap: Array.from({ length: 7 }, () => new Array(24).fill(0)),
				replyGaps: [],
			};
			acc.set(p.name, a);
		}
		return a;
	};

	const biggestWords: BigWord[] = [];
	const sorted = messages.slice().sort((a, b) => a.ts - b.ts);
	let prev: { person: string; ts: number } | null = null;
	let counted = 0;

	for (const m of sorted) {
		const person = resolveSender(m.sender);
		if (!person) continue;
		const a = ensure(person);
		counted++;

		a.messages++;
		if (m.edited) a.edits++;
		if (m.media) a.mediaShared++;

		const links = m.text.match(URL_RE);
		if (links) a.links += links.length;

		const emoji = m.text.match(EMOJI_RE);
		if (emoji) a.emoji += emoji.length;

		const body = prose(m);
		const ws = words(body);
		a.words += ws.length;
		a.characters += body.length;

		for (const w of ws) {
			const lower = w.toLowerCase();
			a.tokens.push(lower);
			a.unique.add(lower);
			const syl = syllables(lower);
			a.syllables += syl;
			// Gunning Fog's "complex word" threshold.
			if (syl >= 3) a.complex++;
			if (commonSet && !commonSet.has(lower)) a.rare++;

			const bare = lower.replace(/['’]/g, '');
			if (SWEAR_SET.has(bare)) {
				a.swearCounts.set(bare, (a.swearCounts.get(bare) ?? 0) + 1);
			}

			if (dictionary && isPlausibleWord(lower) && dictionary.has(lower)) {
				biggestWords.push({ word: lower, person: person.name, quote: m.text, ts: m.ts });
			}
		}

		if (body.length > (a.longest?.chars ?? 0)) {
			a.longest = { chars: body.length, text: m.text, ts: m.ts };
		}

		const d = new Date(m.ts);
		const hour = d.getUTCHours();
		a.hours.push(hour);
		a.heatmap[d.getUTCDay()][hour]++;

		if (prev && prev.person !== person.name) {
			const gapMin = (m.ts - prev.ts) / 60000;
			if (gapMin >= 0 && gapMin <= 10) a.replyGaps.push(gapMin);
		}
		prev = { person: person.name, ts: m.ts };
	}

	// Vote comments, aggregated per person.
	const voteWords = new Map<string, number>();
	for (const vc of voteComments) {
		voteWords.set(vc.person, (voteWords.get(vc.person) ?? 0) + words(vc.comment).length);
	}

	const belowFloor: string[] = [];

	// Group means are pooled over all words, not averaged over people, so one
	// quiet person's outlier doesn't drag the baseline the others shrink toward.
	const totalWords = [...acc.values()].reduce((s, a) => s + a.words, 0) || 1;
	const meanComplex = ([...acc.values()].reduce((s, a) => s + a.complex, 0) / totalWords) * 100;
	const meanRare = ([...acc.values()].reduce((s, a) => s + a.rare, 0) / totalWords) * 100;
	const meanSwear =
		([...acc.values()].reduce((s, a) => s + [...a.swearCounts.values()].reduce((t, n) => t + n, 0), 0) /
			totalWords) *
		1000;

	const people: PersonStats[] = [...acc.values()].map((a) => {
		const swears = [...a.swearCounts.values()].reduce((s, n) => s + n, 0);
		const topSwear =
			[...a.swearCounts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;

		const vocabulary = standardizedTTR(a.tokens, vocabSample, 10, rand);
		if (vocabulary === null) belowFloor.push(`${a.person.name} (${a.tokens.length})`);

		const voted = voters.has(a.person.name);
		const vw = voted ? voteWords.get(a.person.name) ?? 0 : null;
		// Voted but never commented is the extreme of this metric, not a gap.
		const talkToBallot = !voted ? null : vw === 0 ? Infinity : a.words / (vw as number);

		const lateNight = a.hours.filter((h) => h < 5).length;

		return {
			name: a.person.name,
			rookie: a.person.rookie,
			messages: a.messages,
			words: a.words,
			characters: a.characters,
			edits: a.edits,
			links: a.links,
			emoji: a.emoji,
			mediaShared: a.mediaShared,
			swears,
			swearRate: a.words ? (swears / a.words) * 1000 : 0,
			swearRateAdj: shrink(a.words ? (swears / a.words) * 1000 : 0, a.words, meanSwear),
			topSwear,
			vocabulary,
			uniqueWords: a.unique.size,
			complexWords: a.words ? (a.complex / a.words) * 100 : 0,
			complexWordsAdj: shrink(a.words ? (a.complex / a.words) * 100 : 0, a.words, meanComplex),
			rareWords: a.words ? (a.rare / a.words) * 100 : 0,
			rareWordsAdj: shrink(a.words ? (a.rare / a.words) * 100 : 0, a.words, meanRare),
			avgWordsPerMessage: a.messages ? a.words / a.messages : 0,
			longestMessage: a.longest,
			medianReplyMinutes: median(a.replyGaps),
			replies: a.replyGaps.length,
			snapBackRate: a.replyGaps.length
				? a.replyGaps.filter((g) => g <= 1).length / a.replyGaps.length
				: 0,
			voted,
			meanHour: circularMeanHour(a.hours),
			lateNightShare: a.messages ? lateNight / a.messages : 0,
			heatmap: a.heatmap,
			voteCommentWords: vw,
			talkToBallot,
			silentVoter: talkToBallot === Infinity,
		};
	});

	people.sort((a, b) => b.messages - a.messages);

	// Longest word per person, then overall top 10 — so the table isn't one
	// person's thesaurus ten times over.
	const bestPerPerson = new Map<string, BigWord>();
	for (const bw of biggestWords) {
		const cur = bestPerPerson.get(bw.person);
		if (!cur || bw.word.length > cur.word.length) bestPerPerson.set(bw.person, bw);
	}
	const topWords = [...bestPerPerson.values()]
		.sort((a, b) => b.word.length - a.word.length)
		.slice(0, 10);

	const by = <T>(list: PersonStats[], pick: (p: PersonStats) => T, cmp: (a: T, b: T) => number) =>
		list.length ? list.slice().sort((a, b) => cmp(pick(a), pick(b)))[0] : null;

	const desc = (a: number, b: number) => b - a;
	const asc = (a: number, b: number) => a - b;

	const award = (
		p: PersonStats | null | undefined,
		value: string,
		caption: string,
	) => (p ? { person: p.name, value, caption } : null);

	const motormouth = by(people, (p) => p.messages, desc);
	const lurker = by(people, (p) => p.messages, asc);
	const vocabRanked = people.filter((p) => p.vocabulary !== null);
	const vocabKing = by(vocabRanked, (p) => p.vocabulary as number, desc);
	const perfectionist = by(people, (p) => p.edits, desc);
	const explicit = by(people, (p) => p.swearRateAdj, desc);
	const professor = by(people, (p) => p.complexWordsAdj, desc);
	const simplest = by(people, (p) => p.complexWordsAdj, asc);
	const wordsmith = by(people, (p) => p.rareWordsAdj, desc);
	const nightOwl = by(people, (p) => p.lateNightShare, desc);
	const rambler = by(people, (p) => p.longestMessage?.chars ?? 0, desc);
	const linker = by(people, (p) => p.links, desc);
	const emojiKing = by(people, (p) => p.emoji, desc);
	// Minimum reply sample so one lucky exchange can't take the award.
	const fastest = by(
		people.filter((p) => p.replies >= 10),
		(p) => p.snapBackRate,
		desc,
	);
	// Several people can tie at ∞ (voted, never commented). Break the tie on raw
	// chat volume so the award goes to whoever actually talked most.
	const allTalk =
		people
			.filter((p) => p.talkToBallot !== null)
			.sort(
				(a, b) =>
					(b.talkToBallot as number) - (a.talkToBallot as number) || b.words - a.words,
			)[0] ?? null;

	const ts = sorted.map((m) => m.ts);
	const from = ts.length ? ts[0] : 0;
	const to = ts.length ? ts[ts.length - 1] : 0;

	if (belowFloor.length) {
		notes.push(
			`Vocabulary richness needs ${vocabSample} words to score. Below that: ${belowFloor.join(', ')}.`,
		);
	}
	const rookies = people.filter((p) => p.rookie).map((p) => p.name);
	if (rookies.length) {
		notes.push(
			`${rookies.join(', ')} joined mid-season and cast no ballot — excluded from All Talk, No Ballot.`,
		);
	}
	const silentVoters = people.filter((p) => p.voted && p.voteCommentWords === 0).map((p) => p.name);
	if (silentVoters.length) {
		notes.push(
			`${silentVoters.join(', ')} voted without leaving a single comment — an infinite talk-to-ballot ratio, shown as ∞.`,
		);
	}
	notes.push(
		'Big-word, rare-word and swearing rates are adjusted for how much someone wrote. Raw rates quietly punish the people who talk most and hand the top spots to whoever has the least evidence behind their number, so each rate is pulled toward the group average in proportion to how few words back it up. Talking more is not rewarded either: an ordinary rate over 6,000 words stays ordinary.',
	);
	notes.push(
		'Export timestamps are minute-resolution, so response times are rounded to whole minutes; "Quickest Draw" uses the share of replies inside one minute rather than an average.',
	);
	const totalEmoji = people.reduce((s, p) => s + p.emoji, 0);
	notes.push(
		`Reactions are not present in WhatsApp exports, so there is no most-reacted award. The ${totalEmoji} emoji counted here are only those typed into messages.`,
	);

	return {
		generatedFrom: {
			messages: counted,
			from,
			to,
			days: from && to ? Math.max(1, Math.round((to - from) / 86400000)) : 0,
		},
		people,
		biggestWords: topWords,
		awards: {
			motormouth: award(motormouth, `${motormouth?.messages ?? 0} messages`, 'Talked the most. By a lot.'),
			lurker: award(lurker, `${lurker?.messages ?? 0} messages`, 'Present. Barely.'),
			vocabulary: award(vocabKing, `${vocabKing?.vocabulary?.toFixed(1) ?? '—'} richness`, 'Widest vocabulary, volume-adjusted.'),
			biggestWord: topWords[0]
				? { person: topWords[0].person, value: topWords[0].word, caption: `${topWords[0].word.length} letters.` }
				: null,
			professor: award(
				professor,
				`${professor?.complexWordsAdj.toFixed(1) ?? '—'}% big words`,
				'Highest share of three-syllable-plus words.',
			),
			simplest: award(
				simplest,
				`${simplest?.complexWordsAdj.toFixed(1) ?? '—'}% big words`,
				'Says it in the fewest syllables.',
			),
			wordsmith: award(
				wordsmith,
				`${wordsmith?.rareWordsAdj.toFixed(1) ?? '—'}% rare words`,
				'Most words outside the 1,000 most common in English.',
			),
			perfectionist: award(perfectionist, `${perfectionist?.edits ?? 0} edits`, 'Could not leave it alone.'),
			explicit: award(explicit, `${explicit?.swearRateAdj.toFixed(1) ?? '—'} per 1k words`, `Signature: "${explicit?.topSwear ?? '—'}"`),
			allTalk: award(
				allTalk,
				allTalk?.talkToBallot === Infinity ? '∞' : `${allTalk?.talkToBallot?.toFixed(0) ?? '—'}:1`,
				allTalk?.talkToBallot === Infinity
					? 'Voted. Said nothing. Typed thousands of words in chat.'
					: 'Chat words per vote-comment word.',
			),
			nightOwl: award(nightOwl, `${((nightOwl?.lateNightShare ?? 0) * 100).toFixed(0)}% after midnight`, 'Posts when he should be asleep.'),
			rambler: award(rambler, `${rambler?.longestMessage?.chars ?? 0} chars`, 'Longest single message.'),
			linker: award(linker, `${linker?.links ?? 0} links`, 'Most links shared.'),
			emoji: award(emojiKing, `${emojiKing?.emoji ?? 0} emoji`, 'Most emoji sent.'),
			fastest: award(
				fastest,
				`${((fastest?.snapBackRate ?? 0) * 100).toFixed(0)}%`,
				'Share of replies fired back inside a minute.',
			),
		},
		notes,
	};
}
