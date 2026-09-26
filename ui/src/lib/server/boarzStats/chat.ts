// WhatsApp chat analytics for the boarz-stats share site. Pure functions —
// data.ts feeds raw chat rows in. All aggregates are heuristic (no LLM yet);
// the LLM rating pass writes to a separate table later and only refines
// tone/roast fields, so the shapes here stay stable.

import type { Comp } from './stats.js';

export const STATS_TZ = 'America/Chicago';
const BURST_GAP_MS = 15 * 60_000;

export interface ChatMsg {
	sender: string;
	text: string;
	ts: string;
}

export interface StarterAnchor {
	kind: 'round' | 'results';
	label: string;
	ts: string;
}

// chat sender -> canonical person key. Normalized (lowercase, letters only).
const SENDER_ALIAS: Record<string, string> = {
	// Mashew = Matt Mariani (same person — ML handle vs WhatsApp name)
	mattmariani: 'Mashew',
	brian: 'Brian',
	clementsjohnson: 'Clements',
	darren: 'Darren Paletz',
	darrenpallets: 'Darren Paletz',
	darrenpaletz: 'Darren Paletz',
	dave: 'djensen37',
	davidjensen: 'djensen37',
	davejensen: 'djensen37',
	davesteingart: 'Steiny',
	grant: 'Grant Koziol',
	grantkoziol: 'Grant Koziol',
	jimmy: 'Jimmy Troy',
	jimmytroy: 'Jimmy Troy',
	jb: 'Jonathan Black',
	jonblack: 'Jonathan Black',
	jonathanblack: 'Jonathan Black',
	shane: 'Shane Farkas',
	shanefarkas: 'Shane Farkas',
	mashew: 'Mashew',
	cjwookie: 'CJ Wookie',
	steiny: 'Steiny',
	// CJ Wookie is Conor J. — the league calls him Conor ("Conor J. Wookie", see
	// ~ Dave's "Boarz 4 Justice" message). His ML handle is the display name.
	conorj: 'CJ Wookie',
	conorjohnston: 'CJ Wookie',
};

// GroupRelay shows unsaved contacts as raw phone numbers (normSender strips
// digits, so these need exact raw-sender matching before normalization).
const PHONE_ALIAS: Record<string, string> = {
	'+1 (786) 626-6895': 'Mashew',
};

export function normSender(s: string): string {
	return s.normalize('NFKD').replace(/[^a-zA-Z]/g, '').toLowerCase();
}

export function canonicalSender(s: string): string | null {
	return PHONE_ALIAS[s] ?? SENDER_ALIAS[normSender(s)] ?? null;
}

// Mention detection: word-ish tokens -> canonical person.
const MENTION_PATTERNS: [RegExp, string][] = [
	// Conor IS CJ Wookie — chat calls him Conor, his ML handle is CJ Wookie
	[/\bconor/i, 'CJ Wookie'],
	[/\bbrian\b/i, 'Brian'],
	[/\bclements/i, 'Clements'],
	[/\bdarren/i, 'Darren Paletz'],
	[/\b(dave|jensen)/i, 'djensen37'],
	[/steiny|stein/i, 'Steiny'],
	[/\bgrant/i, 'Grant Koziol'],
	[/\bjimmy/i, 'Jimmy Troy'],
	[/\b(jb|jon|jonathan|black)\b/i, 'Jonathan Black'],
	[/\bshane/i, 'Shane Farkas'],
	[/\bmashew\b/i, 'Mashew'],
	[/\bmatt\b/i, 'Mashew'],
	[/\b(cj|wookie)/i, 'CJ Wookie'],
];

const POS_EMOJI = /[\u{1F923}\u{1F602}\u{1F606}\u{1F605}\u{1F525}\u{2764}\u{1F49A}\u{1F451}\u{1F44D}\u{1F44A}\u{1F3C6}\u{1F44C}]/gu;
const NEG_EMOJI = /[\u{1F621}\u{1F92C}\u{1F44E}\u{1F62D}\u{1F4A9}\u{26D4}\u{1F480}]/gu;
const POS_WORDS = /\b(lmao+l?|lmfao|rofl|lol|haha+h?|banger|bangers|heat|goat|legend|winner|best|love|great|elite|fire|classic|chef|beautiful|perfect|incredible|gorgeous)\b/gi;
const NEG_WORDS = /\b(mid|trash|cooked|awful|terrible|hate|worst|rip|doomed|atrocious|garbage|cringe|boring|rough|brutal|unfortunate)\b/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

// --- reaction axes ---------------------------------------------------------
// Every message is rated on its next <=3 replies (weights 3/2/1 — the very
// next reply matters most). Four axes, each in [-1, 1]:
//   energy     — how excited the replies are (emoji, lmao, CAPS, !!!)
//   warmth     — affiliative replies vs spicy/disagreeing ones
//   engagement — how fast + how many distinct people reply
//   momentum   — how much conversation continues after the message
import { AXIS_KEYS, type AxisKey } from '$lib/boarzStats/shared.js';
const REPLY_WEIGHTS = [3, 2, 1];

const WARM_RE = /\b(love|loved|great|nice|good one|beautiful|perfect|solid|respect|legend|king|goat|agree|agreed|fair|true|appreciate|thank)\b/i;
const SPICY_RE = /\b(no|nope|wrong|nah|disagree|trash|mid|awful|terrible|worst|stop|yikes|oof|lie|liar|fraud)\b/i;

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}
const clamp11 = (v: number) => clamp(v, -1, 1);

function replyEnergy(text: string): number {
	const pos = (text.match(POS_EMOJI)?.length ?? 0) + (text.match(POS_WORDS)?.length ?? 0);
	const exclam = (text.match(/!/g) ?? []).length;
	const letters = text.replace(/[^a-zA-Z]/g, '');
	const caps = letters.length > 8 ? (text.match(/[A-Z]/g) ?? []).length / letters.length : 0;
	return clamp(pos * 0.4 + exclam * 0.2 + caps * 2, 0, 1);
}
function replyWarmth(text: string): number {
	const warm = (text.match(WARM_RE)?.length ?? 0) + (text.match(/[\u2764\u{1F49A}\u{1F451}\u{1F44D}\u{1F64C}]/gu)?.length ?? 0);
	const spicy = (text.match(SPICY_RE)?.length ?? 0) + (text.match(NEG_EMOJI)?.length ?? 0);
	return clamp11(warm * 0.6 - spicy * 0.8);
}

export function toneScore(text: string): number {
	let t = 0;
	t += (text.match(POS_EMOJI)?.length ?? 0) + (text.match(POS_WORDS)?.length ?? 0);
	t -= (text.match(NEG_EMOJI)?.length ?? 0) + (text.match(NEG_WORDS)?.length ?? 0);
	return Math.max(-3, Math.min(3, t));
}

function mentionsIn(text: string): Set<string> {
	const found = new Set<string>();
	for (const [re, who] of MENTION_PATTERNS) {
		if (re.test(text)) found.add(who);
	}
	return found;
}

const STOPWORDS = new Set(
	('the and you that this was for are with they have not but his her one all can who get got its out now what when just like really gonna know think yeah yep nope okay ok well them then than there their would could should about into over some been more very much still even also back only come were did does doing dont didnt doesnt cant wont let put say said see look good got want need going right because thats im ive youre guys oh hey man men song songs round round music listen listened vote votes voted submission submit submitted first time times today tomorrow yesterday tonight morning night day week league team name names'.split(
		' '
	))
);

const hourFmt = new Intl.DateTimeFormat('en-US', {
	timeZone: STATS_TZ,
	hour: 'numeric',
	hour12: false,
});
const dayFmt = new Intl.DateTimeFormat('en-CA', {
	timeZone: STATS_TZ,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
});

function topN(counts: Map<string, number>, n: number): { w: string; c: number }[] {
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([w, c]) => ({ w, c }));
}

/** Local-time day (YYYY-MM-DD) for an ISO timestamp. */
export function dayOfTs(ts: string): string {
	return dayFmt.format(new Date(ts));
}

/** Busiest chatter days: local maxima above mean + 1.5σ (min 150 msgs), top 8. */
export function findPeaks(timeline: { day: string; count: number }[]): { day: string; count: number }[] {
	const counts = timeline.map((t) => t.count);
	const mean = counts.reduce((a, c) => a + c, 0) / Math.max(1, counts.length);
	const sd = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / Math.max(1, counts.length));
	const floor = Math.max(mean + 1.5 * sd, 150);
	const peaks = timeline.filter((t, i) => {
		if (t.count < floor) return false;
		const prev = timeline[i - 1]?.count ?? -1;
		const next = timeline[i + 1]?.count ?? -1;
		return t.count >= prev && t.count >= next;
	});
	return peaks.sort((a, b) => b.count - a.count).slice(0, 8).sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Pick the two reaction axes with the biggest swing across players (variance
 * of each axis's player means) and return everyone's position on that pair.
 * Players need >=3 rated messages on both axes to be placed.
 */
function buildQuadrant(people: ChatPerson[]): ChatAgg['quadrant'] {
	const eligible = people.filter((p) => p.react.rated >= 3);
	if (eligible.length < 2) {
		return { axisA: 'engagement', axisB: 'warmth', points: [] };
	}
	const variance = (key: AxisKey): number => {
		const vals = eligible.map((p) => p.react[key] ?? 0);
		const m = vals.reduce((a, c) => a + c, 0) / vals.length;
		return vals.reduce((a, c) => a + (c - m) ** 2, 0) / vals.length;
	};
	const ranked = [...AXIS_KEYS].sort((a, b) => variance(b) - variance(a));
	const axisA = ranked[0];
	const axisB = ranked[1];
	// center each axis on the league average so the quadrant reads as
	// "above / below typical reaction" rather than absolute scale
	const meanA = eligible.reduce((a, p) => a + (p.react[axisA] ?? 0), 0) / eligible.length;
	const meanB = eligible.reduce((a, p) => a + (p.react[axisB] ?? 0), 0) / eligible.length;
	const points = eligible
		.map((p) => ({
			key: p.key,
			display: p.display,
			x: Number(((p.react[axisA] ?? 0) - meanA).toFixed(3)),
			y: Number(((p.react[axisB] ?? 0) - meanB).toFixed(3)),
			n: p.react.rated,
		}))
		.sort((a, b) => b.n - a.n);
	return { axisA, axisB, points };
}

export interface ChatPerson {
	key: string;
	display: string;
	competitorId: number | null;
	msgs: number;
	words: number;
	wpm: number;
	capsPct: number;
	emojiPct: number;
	exclam: number;
	questions: number;
	toneAvg: number;
	hourHist: number[];
	topWords: { w: string; c: number }[];
	topEmoji: string[];
	firstTs: string;
	lastTs: string;
	burstsIgnited: number;
	burstsJoined: number;
	avgBurstSize: number;
	biggestBurst: number;
	roundStarters: number;
	resultStarters: number;
	scrambleMsgs: number;
	/** Mean reaction per axis across their rated messages (null = never rated). */
	react: {
		energy: number | null;
		warmth: number | null;
		engagement: number | null;
		momentum: number | null;
		rated: number;
	};
	mentionGiven: number;
	mentionReceived: number;
	maxAfter60: number;
	igniteSnippet: string | null;
	igniteTs: string | null;
}

export interface Burst {
	start: string;
	end: string;
	size: number;
	people: number;
	spanMin: number;
	starter: string;
	snippet: string;
}

export interface ChatAgg {
	people: ChatPerson[];
	roastMatrix: number[][];
	hourOverall: number[];
	timeline: { day: string; count: number }[];
	/** Messages per canonical person per local day (same days as timeline). */
	timelineByPerson: { day: string; byKey: Record<string, number> }[];
	/** Busiest chatter days — local maxima above the noise floor, for LLM topic summaries. */
	peaks: { day: string; count: number }[];
	/** The two reaction axes with the biggest swing across players, and where everyone lands. */
	quadrant: {
		axisA: AxisKey;
		axisB: AxisKey;
		points: { key: string; display: string; x: number; y: number; n: number }[];
	};
	bursts: Burst[];
	scramble: { label: string; count: number; byKey: Record<string, number> }[];
	selfPromo: { key: string; count: number; songs: string[] }[];
	vibeHall: { display: string; snippet: string; ts: string; after: number }[];
}

export function aggregateChat(
	raw: ChatMsg[],
	anchors: StarterAnchor[],
	scrambleWindows: { label: string; start: string; end: string }[],
	comps: Comp[]
): ChatAgg {
	// map + filter: unknown senders (bots, phone numbers, system) are dropped
	interface Acc extends Omit<ChatPerson, 'wpm' | 'capsPct' | 'emojiPct' | 'toneAvg' | 'topWords' | 'topEmoji' | 'avgBurstSize' | 'react'> {
		_letters: number;
		_caps: number;
		_emojiMsgs: number;
		_tone: number;
		_wordFreq: Map<string, number>;
		_emojiFreq: Map<string, number>;
		_burstSizes: number[];
		_reactSums: Record<AxisKey, number>;
		_reactCounts: Record<AxisKey, number>;
	}

	const people = new Map<string, Acc>();
	const person = (key: string): Acc => {
		let p = people.get(key);
		if (!p) {
			const comp = comps.find((c) => c.name === key);
			p = {
				key,
				display: key,
				competitorId: comp?.id ?? null,
				msgs: 0,
				words: 0,
				exclam: 0,
				questions: 0,
				hourHist: new Array<number>(24).fill(0),
				firstTs: '',
				lastTs: '',
				burstsIgnited: 0,
				burstsJoined: 0,
				biggestBurst: 0,
				roundStarters: 0,
				resultStarters: 0,
				scrambleMsgs: 0,
				mentionGiven: 0,
				mentionReceived: 0,
				maxAfter60: 0,
				igniteSnippet: null,
				igniteTs: null,
				_letters: 0,
				_caps: 0,
				_emojiMsgs: 0,
				_tone: 0,
				_wordFreq: new Map(),
				_emojiFreq: new Map(),
				_burstSizes: [],
				_reactSums: { energy: 0, warmth: 0, engagement: 0, momentum: 0 },
				_reactCounts: { energy: 0, warmth: 0, engagement: 0, momentum: 0 },
			};
			people.set(key, p);
		}
		return p;
	};

	const competitorBySender = new Map(comps.map((comp) => [normSender(comp.name), comp.name]));
	const msgs = raw
		.map((m) => ({ ...m, key: canonicalSender(m.sender) ?? competitorBySender.get(normSender(m.sender)) ?? null }))
		.filter((m) => m.key != null)
		.sort((a, b) => a.ts.localeCompare(b.ts)) as (ChatMsg & { key: string })[];

	const t = (m: { ts: string }) => new Date(m.ts).getTime();
	const hourOf = (m: ChatMsg) => Number(hourFmt.format(new Date(m.ts))) % 24;

	// person order: competitors first (comp order), then guests by volume
	const orderKey = (key: string) => {
		const ci = comps.findIndex((c) => c.name === key);
		return ci >= 0 ? ci : 100 + (people.get(key)?.msgs ?? 0);
	};

	// --- per-message accumulators ------------------------------------------
	for (const m of msgs) {
		const p = person(m.key);
		p.msgs += 1;
		if (!p.firstTs) p.firstTs = m.ts;
		p.lastTs = m.ts;
		p.hourHist[hourOf(m)] += 1;
		const words = m.text.split(/\s+/).filter((w) => w.replace(/\W/g, '').length >= 3);
		p.words += words.length;
		p.exclam += (m.text.match(/!/g) ?? []).length;
		p.questions += (m.text.match(/\?/g) ?? []).length;
		const letters = m.text.replace(/[^a-zA-Z]/g, '');
		if (letters.length > 8) {
			p._letters += letters.length;
			p._caps += (m.text.match(/[A-Z]/g) ?? []).length;
		}
		if (EMOJI_RE.test(m.text)) p._emojiMsgs += 1;
		EMOJI_RE.lastIndex = 0;
		p._tone += toneScore(m.text);
		for (const w of words) {
			const clean = w.toLowerCase().replace(/[^a-z0-9']/g, '');
			if (clean.length < 3 || STOPWORDS.has(clean)) continue;
			p._wordFreq.set(clean, (p._wordFreq.get(clean) ?? 0) + 1);
		}
		for (const e of m.text.match(EMOJI_RE) ?? []) {
			p._emojiFreq.set(e, (p._emojiFreq.get(e) ?? 0) + 1);
		}
	}

	// --- bursts --------------------------------------------------------------
	interface BurstCtx {
		start: number;
		end: number;
		idxs: number[];
		peopleSet: Set<string>;
		starter: string;
	}
	const bursts: BurstCtx[] = [];
	let cur: BurstCtx | null = null;
	for (let i = 0; i < msgs.length; i++) {
		const m = msgs[i];
		if (!cur || t(m) - cur.end > BURST_GAP_MS) {
			cur = { start: t(m), end: t(m), idxs: [i], peopleSet: new Set([m.key]), starter: m.key };
			bursts.push(cur);
		} else {
			cur.end = t(m);
			cur.idxs.push(i);
			cur.peopleSet.add(m.key);
		}
	}
	const after60 = new Array<number>(msgs.length).fill(0);
	for (const b of bursts) {
		for (const i of b.idxs) {
			let n = 0;
			for (const j of b.idxs) {
				if (j > i && t(msgs[j]) - t(msgs[i]) <= 60 * 60_000) n += 1;
			}
			after60[i] = n;
		}
	}
	for (const b of bursts) {
		for (const i of b.idxs) {
			const p = person(msgs[i].key);
			p._burstSizes.push(b.idxs.length);
			p.biggestBurst = Math.max(p.biggestBurst, b.idxs.length);
			if (after60[i] > p.maxAfter60) {
				p.maxAfter60 = after60[i];
				p.igniteSnippet = msgs[i].text.slice(0, 140);
				p.igniteTs = msgs[i].ts;
			}
		}
		const starter = person(b.starter);
		starter.burstsIgnited += 1;
	}

	// --- reaction axes: rate every message on its next <=3 replies -----------
	// Weights 3/2/1 — the immediate reply dominates. A message is only rated
	// when it has at least one reply within the burst (no reply = no signal)
	// and its burst has >=3 messages (an audience exists at all).
	const rate = (key: string, axis: AxisKey, value: number) => {
		const p = person(key);
		p._reactSums[axis] += value;
		p._reactCounts[axis] += 1;
	};
	for (const b of bursts) {
		if (b.idxs.length < 3) continue;
		const tones = b.idxs.map((i) => msgs[i]);
		for (let k = 0; k < tones.length; k++) {
			const replyIdxs = b.idxs.slice(k + 1, k + 1 + REPLY_WEIGHTS.length);
			// momentum: how much conversation continues after this message ([-1, 1])
			const remaining = b.idxs.length - k - 1;
			const remSpanMin = (t(msgs[b.idxs[b.idxs.length - 1]]) - t(msgs[b.idxs[k]])) / 60000;
			rate(
				msgs[b.idxs[k]].key,
				'momentum',
				(clamp(remaining / 25, 0, 1) * 0.5 + clamp(remSpanMin / 180, 0, 1) * 0.5) * 2 - 1
			);
			if (replyIdxs.length === 0) continue;
			let wSum = 0;
			let energy = 0;
			let warmth = 0;
			let engagement = 0;
			const responders = new Set<string>();
			let speedSum = 0;
			let energySum = 0;
			let toneSum = 0;
			replyIdxs.forEach((ri) => {
				const w = REPLY_WEIGHTS[ri - b.idxs[k] - 1];
				const reply = msgs[ri];
				const gapMin = Math.max(0, (t(reply) - t(msgs[b.idxs[k]])) / 60000);
				speedSum += 1 - Math.min(1, gapMin / 120);
				responders.add(reply.key);
				energySum += replyEnergy(reply.text);
				toneSum += toneScore(reply.text);
			});
			// energy: reply hype centered so "no signal" sits slightly negative
			energy = clamp((energySum / replyIdxs.length - 0.2) * 2.5, -1, 1);
			// warmth: reply tone (pos - neg) scaled to [-1, 1]
			warmth = clamp11(toneSum / replyIdxs.length / 2);
			// engagement: distinct repliers out of the 3 possible slots + reply speed
			engagement = ((responders.size / 3) * 0.5 + (speedSum / replyIdxs.length) * 0.5) * 2 - 1;
			wSum = REPLY_WEIGHTS[replyIdxs.length - 1];
			void wSum;
			rate(msgs[b.idxs[k]].key, 'energy', energy);
			rate(msgs[b.idxs[k]].key, 'warmth', warmth);
			rate(msgs[b.idxs[k]].key, 'engagement', engagement);
		}
	}

	// --- starter anchors (round drop / results) ------------------------------
	for (const a of anchors) {
		const t0 = new Date(a.ts).getTime();
		const first = msgs.find((m) => t(m) > t0 && t(m) - t0 <= 48 * 3600_000);
		if (!first) continue;
		const p = person(first.key);
		if (a.kind === 'round') p.roundStarters += 1;
		else p.resultStarters += 1;
	}

	// --- scramble windows ----------------------------------------------------
	const scrambles: { label: string; count: number; byKey: Record<string, number> }[] = [];
	for (const w of scrambleWindows) {
		const byKey: Record<string, number> = {};
		for (const m of msgs) {
			const tm = t(m);
			if (tm >= new Date(w.start).getTime() && tm <= new Date(w.end).getTime()) {
				byKey[m.key] = (byKey[m.key] ?? 0) + 1;
				person(m.key).scrambleMsgs += 1;
			}
		}
		scrambles.push({ label: w.label, count: Object.values(byKey).reduce((a, c) => a + c, 0), byKey });
	}

	// --- roast matrix --------------------------------------------------------
	const roster = [
		...comps.map((c) => c.name),
		'Brian',
	];
	const keyOf = new Map(roster.map((r) => [r, r]));
	const roastMatrix = Array.from({ length: roster.length }, () => new Array<number>(roster.length).fill(0));
	for (const m of msgs) {
		const mentioned = mentionsIn(m.text);
		for (const who of mentioned) {
			if (!keyOf.has(who)) continue;
			const p = person(m.key);
			p.mentionGiven += 1;
			const wi = roster.indexOf(who);
			const si = roster.indexOf(m.key);
			if (si >= 0 && wi >= 0 && si !== wi) roastMatrix[si][wi] += 1;
			const target = people.get(who);
			if (target && who !== m.key) target.mentionReceived += 1;
		}
	}

	// --- finalize people -----------------------------------------------------
	const wordTotalsOthers = new Map<string, number>();
	for (const p of people.values()) for (const [w, c] of p._wordFreq) wordTotalsOthers.set(w, (wordTotalsOthers.get(w) ?? 0) + c);

	const finalized: ChatPerson[] = [...people.values()].map((p) => {
		// distinctive words: lift vs everyone else, min 5 uses
		let liftTop = topN(p._wordFreq, 8);
		const others = new Map(wordTotalsOthers);
		for (const [w, c] of p._wordFreq) others.set(w, (others.get(w) ?? 0) - c);
		const totalMine = [...p._wordFreq.values()].reduce((a, c) => a + c, 0) || 1;
		const totalOthers = [...others.values()].reduce((a, c) => a + c, 0) || 1;
		liftTop = [...p._wordFreq.entries()]
			.filter(([, c]) => c >= 5)
			.map(([w, c]) => {
				const lift = c / totalMine / (Math.max(0, others.get(w) ?? 0) / totalOthers);
				return { w, c: Number(lift.toFixed(2)) };
			})
			.sort((a, b) => b.c - a.c)
			.slice(0, 6);
		return {
			key: p.key,
			display: p.display,
			competitorId: p.competitorId,
			msgs: p.msgs,
			words: p.words,
			wpm: p.msgs ? Number((p.words / p.msgs).toFixed(1)) : 0,
			capsPct: p._letters ? Number(((p._caps / p._letters) * 100).toFixed(1)) : 0,
			emojiPct: p.msgs ? Number(((p._emojiMsgs / p.msgs) * 100).toFixed(1)) : 0,
			exclam: p.exclam,
			questions: p.questions,
			toneAvg: p.msgs ? Number((p._tone / p.msgs).toFixed(2)) : 0,
			hourHist: p.hourHist,
			topWords: liftTop,
			topEmoji: topN(p._emojiFreq, 4).map((e) => e.w),
			firstTs: p.firstTs,
			lastTs: p.lastTs,
			burstsIgnited: p.burstsIgnited,
			burstsJoined: p._burstSizes.length,
			avgBurstSize: p._burstSizes.length ? Number((p._burstSizes.reduce((a, c) => a + c, 0) / p._burstSizes.length).toFixed(1)) : 0,
			biggestBurst: p.biggestBurst,
			roundStarters: p.roundStarters,
			resultStarters: p.resultStarters,
			scrambleMsgs: p.scrambleMsgs,
			react: {
				energy: p._reactCounts.energy ? Number((p._reactSums.energy / p._reactCounts.energy).toFixed(2)) : null,
				warmth: p._reactCounts.warmth ? Number((p._reactSums.warmth / p._reactCounts.warmth).toFixed(2)) : null,
				engagement: p._reactCounts.engagement ? Number((p._reactSums.engagement / p._reactCounts.engagement).toFixed(2)) : null,
				momentum: p._reactCounts.momentum ? Number((p._reactSums.momentum / p._reactCounts.momentum).toFixed(2)) : null,
				rated: p._reactCounts.energy,
			},
			mentionGiven: p.mentionGiven,
			mentionReceived: p.mentionReceived,
			maxAfter60: p.maxAfter60,
			igniteSnippet: p.igniteSnippet,
			igniteTs: p.igniteTs,
		};
	});
	finalized.sort((a, b) => orderKey(a.key) - orderKey(b.key));

	// matrix indexed by finalized person order
	const aligned: number[][] = finalized.map((p) =>
		finalized.map((q) => {
			const ri = roster.indexOf(p.key);
			const rj = roster.indexOf(q.key);
			return ri >= 0 && rj >= 0 ? roastMatrix[ri][rj] : 0;
		})
	);

	// --- timeline -------------------------------------------------------------
	const dayCounts = new Map<string, number>();
	const dayByPerson = new Map<string, Map<string, number>>();
	for (const m of msgs) {
		const day = dayFmt.format(new Date(m.ts));
		dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
		let per = dayByPerson.get(day);
		if (!per) dayByPerson.set(day, (per = new Map()));
		per.set(m.key, (per.get(m.key) ?? 0) + 1);
	}
	const timeline = [...dayCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, count]) => ({ day, count }));
	const timelineByPerson = [...dayByPerson.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([day, per]) => ({ day, byKey: Object.fromEntries(per) }));

	// --- bursts out -----------------------------------------------------------
	const burstOut: Burst[] = bursts
		.filter((b) => b.idxs.length >= 3)
		.sort((a, b) => b.idxs.length - a.idxs.length)
		.slice(0, 12)
		.map((b) => ({
			start: msgs[b.idxs[0]].ts,
			end: msgs[b.idxs[b.idxs.length - 1]].ts,
			size: b.idxs.length,
			people: b.peopleSet.size,
			spanMin: Math.round((b.end - b.start) / 60000),
			starter: b.starter,
			snippet: msgs[b.idxs[0]].text.slice(0, 120),
		}));

	return {
		people: finalized,
		roastMatrix: aligned,
		hourOverall: finalized.reduce((acc, p) => acc.map((c, i) => c + p.hourHist[i]), new Array<number>(24).fill(0)),
		timeline,
		timelineByPerson,
		peaks: findPeaks(timeline),
		quadrant: buildQuadrant(finalized),
		bursts: burstOut,
		scramble: scrambles,
		selfPromo: [],
		vibeHall: finalized
			.filter((p) => p.igniteSnippet)
			.sort((a, b) => b.maxAfter60 - a.maxAfter60)
			.slice(0, 5)
			.map((p) => ({ display: p.display, snippet: p.igniteSnippet!, ts: p.igniteTs!, after: p.maxAfter60 })),
	};
}
