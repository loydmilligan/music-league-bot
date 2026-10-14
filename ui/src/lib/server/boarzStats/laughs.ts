// Laugh Track: who laughs in the chat, and whose messages make them laugh.
//
// Kept separate from aggregateChat on purpose — that function feeds every stats
// surface, and this is an additive extra the snapshot builder calls inside a
// try/catch. Text-only today: a "laugh" is a message carrying 😂/🤣/💀 or a
// haha/lol/lmao. WhatsApp notification relays never see reactions to other
// people's messages, so emoji REACTIONS arrive separately (the bot's own
// session records them in chat_reactions) and are merged in when present.

import type Database from 'better-sqlite3';
import { canonicalSender, normSender } from './chat.js';

export interface LaughMsg {
	sender: string;
	text: string;
	ts: string;
}

/** A 😂-style reaction the bot saw: who reacted, and who wrote the message. */
export interface LaughReaction {
	reactorName: string;
	authorName: string;
	ts: string;
	snippet: string | null;
}

export interface LaughPerson {
	key: string;
	display: string;
	/** Laughs this person sent (text laughs + laugh reactions). */
	given: number;
	/** Laughs credited to this person's messages by other people. */
	drawn: number;
}

export interface LaughTrack {
	people: LaughPerson[];
	/** The single message that drew the most laughs from other people. */
	biggest: { display: string; snippet: string; ts: string; laughs: number; laughers: string[] } | null;
	textLaughs: number;
	reactionLaughs: number;
}

const LAUGH_EMOJI = /[\u{1F602}\u{1F923}\u{1F480}]/u; // 😂 🤣 💀
const LAUGH_WORDS = /\b(?:ha(?:ha)+h?|lo+l+|lmf?ao+|rofl)\b/i;
/** A laugh credits the most recent message by someone else within this window. */
const CREDIT_WINDOW_MS = 10 * 60_000;

export function isLaugh(text: string): boolean {
	return LAUGH_EMOJI.test(text) || LAUGH_WORDS.test(text);
}

export function buildLaughTrack(
	raw: LaughMsg[],
	comps: { name: string }[],
	displayOf: (key: string) => string,
	reactions: LaughReaction[] = [],
): LaughTrack {
	const competitorBySender = new Map(comps.map((c) => [normSender(c.name), c.name]));
	const keyOf = (sender: string) => canonicalSender(sender) ?? competitorBySender.get(normSender(sender)) ?? null;
	const msgs = raw
		.map((m) => ({ ...m, key: keyOf(m.sender) }))
		.filter((m): m is LaughMsg & { key: string } => m.key != null && !m.text.startsWith('Reacted '))
		.sort((a, b) => a.ts.localeCompare(b.ts));

	const given = new Map<string, number>();
	const drawn = new Map<string, number>();
	const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
	// per target message index → set of laughers
	const laughersByMsg = new Map<number, Set<string>>();

	let textLaughs = 0;
	for (let i = 0; i < msgs.length; i++) {
		const m = msgs[i];
		if (!isLaugh(m.text)) continue;
		textLaughs += 1;
		bump(given, m.key);
		const at = new Date(m.ts).getTime();
		for (let j = i - 1; j >= 0; j--) {
			const prev = msgs[j];
			if (at - new Date(prev.ts).getTime() > CREDIT_WINDOW_MS) break;
			if (prev.key === m.key) continue;
			// A laugh replying to a laugh is still credited back to the joke.
			if (isLaugh(prev.text)) continue;
			bump(drawn, prev.key);
			const set = laughersByMsg.get(j) ?? new Set<string>();
			set.add(m.key);
			laughersByMsg.set(j, set);
			break;
		}
	}

	let reactionLaughs = 0;
	for (const r of reactions) {
		const reactor = keyOf(r.reactorName);
		const author = keyOf(r.authorName);
		if (!reactor) continue;
		reactionLaughs += 1;
		bump(given, reactor);
		if (author && author !== reactor) bump(drawn, author);
	}

	const keys = new Set([...given.keys(), ...drawn.keys()]);
	const people: LaughPerson[] = [...keys]
		.map((key) => ({ key, display: displayOf(key), given: given.get(key) ?? 0, drawn: drawn.get(key) ?? 0 }))
		.sort((a, b) => b.drawn - a.drawn || b.given - a.given || a.display.localeCompare(b.display));

	let biggest: LaughTrack['biggest'] = null;
	for (const [idx, set] of laughersByMsg) {
		if (!biggest || set.size > biggest.laughs) {
			const m = msgs[idx];
			biggest = {
				display: displayOf(m.key),
				snippet: m.text.slice(0, 160),
				ts: m.ts,
				laughs: set.size,
				laughers: [...set].map(displayOf),
			};
		}
	}

	return { people, biggest, textLaughs, reactionLaughs };
}

const LAUGH_REACTIONS = ['😂', '🤣', '💀'];

/**
 * Laugh reactions the bot recorded (table `chat_reactions`, written by the
 * bot's WhatsApp session — see src/storage/reactionsDb.ts). Returns [] when
 * the table does not exist yet or nothing matches.
 */
export function readLaughReactions(
	db: Database.Database,
	groupName: string,
	from: string,
	to: string,
): LaughReaction[] {
	if (!groupName || !from || !to) return [];
	try {
		// The bot's session can't read chat names in this wwebjs build, so rows
		// carry only chat_id; settings.wa_group_names maps id → relay group name.
		let ids: string[] = [];
		try {
			const raw = (db.prepare(`SELECT value FROM settings WHERE key = 'wa_group_names'`).get() as { value?: string } | undefined)?.value;
			const map = JSON.parse(raw ?? '{}') as Record<string, string>;
			ids = Object.entries(map).filter(([, name]) => name === groupName).map(([id]) => id);
		} catch {
			ids = [];
		}
		const rows = db
			.prepare(
				`SELECT reactor_name AS reactorName, target_author_name AS authorName, ts, target_snippet AS snippet
				 FROM chat_reactions
				 WHERE (group_name = ? OR chat_id IN (${ids.map(() => '?').join(',') || "''"}))
				   AND ts >= ? AND ts <= ? AND removed = 0
				   AND reaction IN (${LAUGH_REACTIONS.map(() => '?').join(',')})`,
			)
			.all(groupName, ...ids, from, to, ...LAUGH_REACTIONS) as {
			reactorName: string | null;
			authorName: string | null;
			ts: string;
			snippet: string | null;
		}[];
		return rows
			.filter((r) => r.reactorName)
			.map((r) => ({ reactorName: r.reactorName!, authorName: r.authorName ?? '', ts: r.ts, snippet: r.snippet }));
	} catch {
		return [];
	}
}
