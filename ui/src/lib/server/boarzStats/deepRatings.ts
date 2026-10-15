// Aggregates Jev message ratings (boarz-msg-ratings.db) into per-player
// profiles, predicted-vs-actual boards, and composite scores (taxonomy
// §33/§34). Read-only on both DBs. Returns null when the ratings DB hasn't
// been backfilled yet.

import Database from 'better-sqlite3';
import { join } from 'node:path';
import type { Comp } from './stats.js';
import { canonicalSender } from './chat.js';

export interface PlayerRatings {
	key: string;
	display: string;
	competitorId: number | null;
	msgsRated: number;
	// tag mix (share of messages, threshold 0.6)
	shareReaction: number;
	shareMedia: number;
	shareLink: number;
	shareMusic: number;
	shareBanter: number;
	shareLogistics: number;
	// percentile-normalized means (0–1, vs whole-message distribution) — used by visuals
	pctHeat: number | null;
	pctAffection: number | null;
	pctChaos: number | null;
	pctEnergy: number | null;
	pctMainCharacter: number | null;
	pctCommissioner: number | null;
	pctMeme: number | null;
	pctPull: number | null;
	// raw means (0–3) kept for tooltips
	avgHeat: number | null;
	avgAffection: number | null;
	avgChaos: number | null;
	avgEnergy: number | null;
	// composites (§33)
	chatGravity: number | null; // avg actual replies-in-60m (capped 10) per message
	pullVsActual: number | null; // predicted pull (0–1) minus actual (0–1); + = talks bigger than walks
	mainCharacter: number | null;
	commissioner: number | null;
	memePotential: number | null;
	slopIndex: number | null; // profanity + caps share of messages
	roastsGiven: number;
	selfRoasts: number;
	praiseGiven: number;
	avgConfidence: number;
	/** Up to three messages that most strongly express each profile trait. */
	evidence: Record<FingerprintTrait, { high: { text: string; ts: string; score: number }[]; low: { text: string; ts: string; score: number } | null }>;
}

export type FingerprintTrait = 'heat' | 'chaos' | 'affection' | 'mainCharacter' | 'commissioner' | 'meme';

export interface DeepRatings {
	players: PlayerRatings[];
	spiciest: { display: string; text: string; heat: number; roast: string; ts: string }[];
	bestMemes: { display: string; text: string; meme: number; pull: number; ts: string }[];
	tagMix: Record<string, number>;
	/** per-dimension extreme messages — powers "what's driving this metric" */
	drivers: Record<string, { display: string; text: string; ts: string; v: number }[]>;
	coverage: { rated: number; total: number; avgConfidence: number; totalCost: number };
}

const TAG_THRESHOLD = 0.6;

export function buildDeepRatings(leagueDbPath: string, comps: Comp[]): DeepRatings | null {
	const ratingsPath = join(process.env.DATA_DIR ?? 'data', 'boarz-msg-ratings.db');
	let ratings: Database.Database;
	try {
		ratings = new Database(ratingsPath, { readonly: true, fileMustExist: true });
	} catch {
		return null;
	}

	interface Row {
		msg_id: string;
		heat: number;
		energy: number;
		affection: number;
		chaos: number;
		conversation_pull: number;
		main_character: number;
		commissioner_energy: number;
		meme_potential: number;
		roast_target: string;
		praise: number;
		profanity: number;
		caps_energy: number;
		mean_confidence: number;
		is_reaction: number;
		is_music: number;
		is_banter: number;
		has_link: number;
		has_media: number;
		is_logistics: number;
		outcome_json: string | null;
		sender: string;
		text: string;
		ts: string;
	}

	// attach the league db to read senders/text without a second connection
	ratings.exec(`ATTACH DATABASE '${leagueDbPath.replace(/'/g, "''")}' AS lg`);
	const rows = ratings
		.prepare(
			`SELECT r.msg_id, r.heat, r.energy, r.affection, r.chaos, r.conversation_pull,
				r.main_character, r.commissioner_energy, r.meme_potential, r.roast_target,
				r.praise, r.profanity, r.caps_energy, r.mean_confidence,
				r.is_reaction, r.is_music, r.is_banter, r.has_link, r.has_media, r.is_logistics,
				r.outcome_json, l.sender, l.text, l.ts
			 FROM chat_msg_ratings_v2 r
			 JOIN lg.chat_messages l ON l.id = r.msg_id
			 WHERE l.group_name LIKE 'Boarz%'`
		)
		.all() as unknown as Row[];

	// --- normalization ---------------------------------------------------------
	// Raw 0–3 scores compress hard at the low end (heat: 24% of messages sit at
	// 0.0), so per-player means squash into 0.1–0.3. Percentile ranks against
	// the whole-message distribution spread every dimension evenly onto 0–1;
	// raw means stay for tooltips.
	interface Dist {
		values: Float64Array;
	}
	const dists = new Map<string, Float64Array>();
	const dimsForPct = ['heat', 'energy', 'affection', 'chaos', 'conversation_pull', 'main_character', 'commissioner_energy', 'meme_potential'];
	for (const d of dimsForPct) {
		const vals = ratings.prepare(`SELECT ${d} v FROM chat_msg_ratings_v2 ORDER BY ${d}`).all() as unknown as { v: number }[];
		dists.set(d, Float64Array.from(vals.map((x) => x.v)));
	}

	/** percentile of a raw value within the sorted distribution (0..1). */
	function pctOf(dim: string, v: number): number {
		const arr = dists.get(dim);
		if (!arr || arr.length === 0) return 0.5;
		let lo = 0;
		let hi = arr.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (arr[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		return lo / arr.length;
	}

	const totalChat = ratings
		.prepare(`SELECT COUNT(*) n, AVG(mean_confidence) conf FROM chat_msg_ratings_v2`)
		.get() as { n: number; conf: number | null };

	interface Acc {
		n: number;
		heat: number;
		energy: number;
		affection: number;
		chaos: number;
		pull: number;
		pullActual: number;
		outcomes: number;
		mainChar: number;
		commissioner: number;
		meme: number;
		profanity: number;
		caps: number;
		conf: number;
		reaction: number;
		music: number;
		banter: number;
		link: number;
		media: number;
		logistics: number;
		roasts: number;
		selfRoasts: number;
		praise: number;
	}

	const acc = new Map<string, Acc>();
	const evidenceByPlayer = new Map<string, Record<FingerprintTrait, { high: { text: string; ts: string; score: number }[]; low: { text: string; ts: string; score: number } | null }>>();
	const displayByKey = new Map<string, string>();
	const competitorIdByKey = new Map<string, number>();
	const person = (key: string): Acc => {
		let a = acc.get(key);
		if (!a) {
			a = { n: 0, heat: 0, energy: 0, affection: 0, chaos: 0, pull: 0, pullActual: 0, outcomes: 0, mainChar: 0, commissioner: 0, meme: 0, profanity: 0, caps: 0, conf: 0, reaction: 0, music: 0, banter: 0, link: 0, media: 0, logistics: 0, roasts: 0, selfRoasts: 0, praise: 0 };
			acc.set(key, a);
		}
		return a;
	};
	const emptyEvidence = (): Record<FingerprintTrait, { high: { text: string; ts: string; score: number }[]; low: { text: string; ts: string; score: number } | null }> => ({
		heat: { high: [], low: null }, chaos: { high: [], low: null }, affection: { high: [], low: null },
		mainCharacter: { high: [], low: null }, commissioner: { high: [], low: null }, meme: { high: [], low: null },
	});
	for (const c of comps) {
		const key = canonicalSender(c.botName ?? c.name) ?? c.botName ?? c.name;
		person(key); // everyone appears even if chat-quiet
		evidenceByPlayer.set(key, emptyEvidence());
		displayByKey.set(key, c.name);
		competitorIdByKey.set(key, c.id);
	}

	const spiciest: DeepRatings['spiciest'] = [];
	const bestMemes: DeepRatings['bestMemes'] = [];
	const tagMix: Record<string, number> = { reaction: 0, music: 0, banter: 0, link: 0, media: 0, logistics: 0 };
	/** metric explanation tap: which messages drive a player's extreme percentiles */
	const drivers: Record<string, { display: string; text: string; ts: string; v: number }[]> = {
		heat: [], chaos: [], affection: [], mainCharacter: [], meme: [], pull: [],
	};

	for (const r of rows) {
		const key = canonicalSender(r.sender);
		if (!key || !acc.has(key)) continue;
		const a = acc.get(key)!;
		a.n += 1;
		a.heat += r.heat / 3;
		a.energy += r.energy / 3;
		a.affection += r.affection / 3;
		a.chaos += r.chaos / 3;
		a.pull += r.conversation_pull / 3;
		a.mainChar += r.main_character / 3;
		a.commissioner += r.commissioner_energy / 3;
		a.meme += r.meme_potential / 3;
		a.profanity += r.profanity >= TAG_THRESHOLD ? 1 : 0;
		a.caps += r.caps_energy >= TAG_THRESHOLD ? 1 : 0;
		a.conf += r.mean_confidence;
		if (r.is_reaction >= TAG_THRESHOLD) { a.reaction += 1; tagMix.reaction += 1; }
		if (r.is_music >= TAG_THRESHOLD) { a.music += 1; tagMix.music += 1; }
		if (r.is_banter >= TAG_THRESHOLD) { a.banter += 1; tagMix.banter += 1; }
		if (r.has_link >= TAG_THRESHOLD) { a.link += 1; tagMix.link += 1; }
		if (r.has_media >= TAG_THRESHOLD) { a.media += 1; tagMix.media += 1; }
		if (r.is_logistics >= TAG_THRESHOLD) { a.logistics += 1; tagMix.logistics += 1; }
		if (r.roast_target === 'other') a.roasts += 1;
		if (r.roast_target === 'self') a.selfRoasts += 1;
		if (r.praise >= TAG_THRESHOLD) a.praise += 1;

		if (r.outcome_json) {
			const o = JSON.parse(r.outcome_json) as { replies_60m?: number; ignored?: boolean };
			a.pullActual += Math.min(1, (o.replies_60m ?? 0) / 10);
			a.outcomes += 1;
		}

		if (key !== 'Brian' && key !== 'Bagel Shop' && r.heat >= 1.8) {
			spiciest.push({ display: displayByKey.get(key) ?? key, text: r.text.slice(0, 140), heat: r.heat, roast: r.roast_target, ts: r.ts });
		}
		if (r.meme_potential >= 2 && r.conversation_pull >= 1.5) {
			bestMemes.push({ display: displayByKey.get(key) ?? key, text: r.text.slice(0, 140), meme: r.meme_potential, pull: r.conversation_pull, ts: r.ts });
		}
		// driver collection: the single most extreme message per dimension per player
		const dimDrivers: [keyof typeof drivers, number][] = [
			['heat', r.heat], ['chaos', r.chaos], ['affection', 3 - r.affection], ['mainCharacter', r.main_character], ['meme', r.meme_potential], ['pull', r.conversation_pull],
		];
		for (const [dim, v] of dimDrivers) {
			const list = drivers[dim];
			if (list.length < 400 || v > list[list.length - 1]?.v) {
				list.push({ display: displayByKey.get(key) ?? key, text: r.text.slice(0, 140), ts: r.ts, v });
				list.sort((x, y) => y.v - x.v);
				if (list.length > 400) list.pop();
			}
		}
		const traitScores: [FingerprintTrait, number][] = [
			['heat', r.heat], ['chaos', r.chaos], ['affection', r.affection],
			['mainCharacter', r.main_character], ['commissioner', r.commissioner_energy], ['meme', r.meme_potential],
		];
		const evidence = evidenceByPlayer.get(key);
		if (evidence) for (const [trait, score] of traitScores) {
			const target = evidence[trait];
			const item = { text: r.text.slice(0, 260), ts: r.ts, score };
			if (target.high.length < 2 || score > target.high[target.high.length - 1].score) {
				target.high.push(item);
				target.high.sort((a, b) => b.score - a.score);
				if (target.high.length > 2) target.high.pop();
			}
			if (!target.low || score < target.low.score) target.low = item;
		}
	}

	const players: PlayerRatings[] = [...acc.entries()]
		.map(([key, a]) => {
			const n = Math.max(1, a.n);
			const avgHeat = a.n ? a.heat / n : null;
			const avgAffection = a.n ? a.affection / n : null;
			const avgChaos = a.n ? a.chaos / n : null;
			const avgEnergy = a.n ? a.energy / n : null;
			const avgMainChar = a.n ? a.mainChar / n : null;
			const avgCommissioner = a.n ? a.commissioner / n : null;
			const avgMeme = a.n ? a.meme / n : null;
			const avgPull = a.n ? a.pull / n : null;
			return {
				key,
				display: displayByKey.get(key) ?? key,
				competitorId: competitorIdByKey.get(key) ?? null,
				msgsRated: a.n,
				shareReaction: a.reaction / n,
				shareMusic: a.music / n,
				shareBanter: a.banter / n,
				shareLink: a.link / n,
				shareMedia: a.media / n,
				shareLogistics: a.logistics / n,
				pctHeat: avgHeat != null ? pctOf('heat', avgHeat) : null,
				pctAffection: avgAffection != null ? pctOf('affection', avgAffection) : null,
				pctChaos: avgChaos != null ? pctOf('chaos', avgChaos) : null,
				pctEnergy: avgEnergy != null ? pctOf('energy', avgEnergy) : null,
				pctMainCharacter: avgMainChar != null ? pctOf('main_character', avgMainChar) : null,
				pctCommissioner: avgCommissioner != null ? pctOf('commissioner_energy', avgCommissioner) : null,
				pctMeme: avgMeme != null ? pctOf('meme_potential', avgMeme) : null,
				pctPull: avgPull != null ? pctOf('conversation_pull', avgPull) : null,
				avgHeat,
				avgAffection,
				avgChaos,
				avgEnergy,
				chatGravity: a.outcomes ? a.pullActual / a.outcomes : null,
				pullVsActual: a.outcomes ? a.pull / a.outcomes - a.pullActual / a.outcomes : null,
				mainCharacter: avgMainChar,
				commissioner: avgCommissioner,
				memePotential: avgMeme,
				slopIndex: a.n ? (a.profanity + a.caps) / n : null,
				roastsGiven: a.roasts,
				selfRoasts: a.selfRoasts,
				praiseGiven: a.praise,
				avgConfidence: a.n ? a.conf / n : 0,
				evidence: evidenceByPlayer.get(key) ?? emptyEvidence(),
			};
		})
		.sort((x, y) => y.msgsRated - x.msgsRated);

	// --- visual normalization --------------------------------------------------
	// Percentile-of-mean still cliffs when Jev's distribution is bimodal (e.g.
	// affection collapses to "neutral" vs "affectionate"), so visuals use
	// player-relative min-max scaling: each dimension is stretched so the
	// quietest player is 0 and the loudest is 1. Tooltips always carry the raw
	// mean, so no information is lost — this is purely presentation.
	const pctFields = ['pctHeat', 'pctAffection', 'pctChaos', 'pctEnergy', 'pctMainCharacter', 'pctCommissioner', 'pctMeme', 'pctPull'] as const;
	for (const f of pctFields) {
		const vals = players.map((p) => (p[f] as number | null) ?? 0);
		const min = Math.min(...vals);
		const max = Math.max(...vals);
		const span = max - min;
		for (const p of players) {
			p[f] = (p[f] as number | null) == null ? null : span > 0 ? ((p[f] as number) - min) / span : 0.5;
		}
	}

	spiciest.sort((x, y) => y.heat - x.heat);
	bestMemes.sort((x, y) => y.meme - x.meme || y.pull - x.pull);

	const costRow = ratings
		.prepare(`SELECT SUM(cost_usd) c FROM chat_msg_ratings_v2`)
		.get() as { c: number | null };

	ratings.close();

	return {
		players,
		spiciest: spiciest.slice(0, 8),
		bestMemes: bestMemes.slice(0, 8),
		tagMix,
		/** per-dimension extreme messages — powers "what's driving this metric" */
		drivers,
		coverage: {
			rated: rows.length,
			total: (totalChat.n as number) ?? rows.length,
			avgConfidence: (totalChat.conf as number) ?? 0,
			totalCost: costRow.c ?? 0,
		},
	};
}
