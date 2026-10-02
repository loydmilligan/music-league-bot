// Resumable backfill: rate every Boarz chat message + vote comment with Jev.
// One message per call — batched multi-message calls collapse (Jev's answers
// converge to the same distribution past ~100 questions/call), while a single
// message with the full 48-question schema stays sharp. Writes immediately so
// re-runs resume. 4 parallel workers.
//
//   cd ui && npx tsx ../scripts/backfill-chat-ratings.ts [--league <slug>] [--limit N] [--skip-votes]
//
// Cost: ~$0.00009/msg → ~$1.35 for ~15.4k items.

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildQuestions,
	jevDecide,
	parseAnswers,
	type JevAnswer,
	type JevUsage,
} from '../ui/src/lib/server/boarzStats/jev.js';
import {
	insertChatRating,
	insertVoteRating,
	openRatingsDb,
	ratedChatIds,
	ratedVoteIds,
	updateOutcome,
} from '../ui/src/lib/server/boarzStats/ratingsDb.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ?? resolve(ROOT, 'data');
const RATINGS_PATH = resolve(DATA_DIR, 'boarz-msg-ratings.db');
const BATCH = 10;
const WORKERS = 4;

function argValue(flag: string): number | null {
	const idx = process.argv.indexOf(flag);
	return idx >= 0 ? Number(process.argv[idx + 1]) : null;
}
function argStr(flag: string): string | null {
	const idx = process.argv.indexOf(flag);
	return idx >= 0 ? (process.argv[idx + 1] ?? null) : null;
}
const LIMIT = argValue('--limit') ?? Infinity;
const SKIP_VOTES = process.argv.includes('--skip-votes');
const LEAGUE_SLUG = argStr('--league') ?? 'boarz-ii-men';

// Chat messages are keyed by group_name (not a league fk). Resolve the league's
// group via the same chat_league_group_map settings row the digest uses.
function chatGroupName(slug: string): string {
	const db = openLeague();
	const row = db
		.prepare("SELECT value FROM settings WHERE key = 'chat_league_group_map'")
		.get() as { value?: string } | undefined;
	db.close();
	const map = JSON.parse(row?.value ?? '{}') as Record<string, string>;
	const g = map[slug];
	if (!g) throw new Error(`no chat group mapped for league '${slug}' (chat_league_group_map)`);
	return g;
}

function loadApiKey(): string {
	if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
	const envPath = resolve(ROOT, '.env');
	if (existsSync(envPath)) {
		for (const line of readFileSync(envPath, 'utf8').split('\n')) {
			const m = line.match(/^OPENROUTER_API_KEY=(.+)\s*$/);
			if (m) return m[1].trim();
		}
	}
	throw new Error('OPENROUTER_API_KEY not set (export it or put it in .env)');
}

interface Item {
	key: string;
	sender: string;
	text: string;
}

function openLeague(): Database.Database {
	return new Database(resolve(DATA_DIR, 'league.db'), { readonly: true, fileMustExist: true });
}

function loadChatMessages(): Item[] {
	const db = openLeague();
	const rows = db
		.prepare(
			`SELECT id, sender, text, ts FROM chat_messages
			 WHERE group_name = ? AND length(trim(text)) > 0
			 ORDER BY ts`
		)
		.all(chatGroupName(LEAGUE_SLUG)) as unknown as { id: string; sender: string; text: string; ts: string }[];
	db.close();
	return rows.map((r) => ({ key: r.id, sender: r.sender, text: r.text.slice(0, 600), ts: r.ts }));
}

/**
 * Outcome features (taxonomy §1.5) — measured ground truth from the message
 * stream, joined onto every rating row so predicted-vs-actual is queryable.
 */
function computeOutcomes(items: Item[]): void {
	const db = openRatingsDb(RATINGS_PATH, true);
	const t = (m: Item) => new Date(m.ts).getTime();
	for (let i = 0; i < items.length; i++) {
		const m = items[i];
		const t0 = t(m);
		// replies within 60 minutes, from anyone else
		const window: Item[] = [];
		let j = i + 1;
		while (j < items.length && t(items[j]) - t0 <= 60 * 60_000) {
			window.push(items[j]);
			j += 1;
		}
		const others = window.filter((w) => w.sender !== m.sender);
		const responders = new Set(others.map((w) => w.sender));
		// silence after: minutes until the very next message by anyone (capped 240)
		const silenceMin = window.length ? Math.min(240, (t(window[0]) - t0) / 60000) : 240;
		updateOutcome(db, m.key, {
			replies_60m: others.length,
			unique_responders_60m: responders.size,
			first_reply_min: others.length ? (t(others[0]) - t0) / 60000 : null,
			conversation_continued_min: Math.min(240, others.length ? (t(others[others.length - 1]) - t0) / 60000 : 0),
			ignored: others.length === 0 && silenceMin >= 60,
			responders: [...responders].slice(0, 8),
		});
	}
	db.close();
}

function loadVoteComments(): { voteId: number; comment: string }[] {
	const db = openLeague();
	const rows = db
		.prepare(
			`SELECT v.id, v.comment FROM votes v
			 JOIN rounds r ON v.round_id = r.id
			 JOIN seasons s ON r.season_id = s.id
			 WHERE s.league_id = (SELECT id FROM leagues WHERE slug = ?)
			   AND v.comment IS NOT NULL AND length(trim(v.comment)) > 0
			 ORDER BY v.created_at`
		)
		.all(LEAGUE_SLUG) as unknown as { id: number; comment: string }[];
	db.close();
	return rows.map((r) => ({ voteId: r.id, comment: r.comment.slice(0, 600) }));
}

async function rateOne(
	apiKey: string,
	item: Item,
	prefix = 'm0'
): Promise<{ answers: Record<string, JevAnswer>; usage: JevUsage; model: string }> {
	const state = { message: `sent by ${item.sender}: ${item.text.replace(/\s+/g, ' ')}` };
	let lastErr: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return await jevDecide(state, buildQuestions(0), apiKey);
		} catch (err) {
			lastErr = err;
			if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
		}
	}
	throw lastErr;
}

async function main() {
	const apiKey = process.env.OPENROUTER_API_KEY!;
	const db = openRatingsDb(RATINGS_PATH, true);

	// --- chat messages -------------------------------------------------------
	const done = ratedChatIds(db);
	const msgs = loadChatMessages();
	const pending = msgs.filter((m) => !done.has(m.key)).slice(0, Number.isFinite(LIMIT) ? LIMIT : Infinity);
	console.log(`[backfill] chat: ${msgs.length} total, ${done.size} rated, ${pending.length} pending`);

	let spent = 0;
	let rated = 0;
	let failures = 0;
	let next = 0;
	const t0 = Date.now();

	async function worker(): Promise<void> {
		for (;;) {
			const idx = next;
			if (idx >= pending.length) return;
			next += 1;
			const msg = pending[idx];
			try {
				const res = await rateOne(apiKey, msg);
				insertChatRating(db, msg.key, res.model ?? 'typesafe/jev-1.13', parseAnswers(res.answers, 0), res.answers, res.usage.cost);
				spent += res.usage.cost;
				rated += 1;
				if (rated % 250 === 0 || rated === pending.length) {
					const elapsed = (Date.now() - t0) / 1000;
					const minsLeft = ((pending.length - rated) / (rated / elapsed)) / 60;
					console.log(`[backfill] ${rated}/${pending.length} · $${spent.toFixed(4)} · ~${minsLeft.toFixed(0)} min left`);
				}
			} catch (err) {
				failures += 1;
				if (failures <= 5) console.error(`[backfill] @${idx} failed:`, (err as Error).message?.slice(0, 140));
			}
		}
	}

	await Promise.all(Array.from({ length: WORKERS }, () => worker()));
	console.log(`[backfill] chat done: ${rated} rated, ${failures} failed, $${spent.toFixed(4)}`);

	// --- outcomes: measured ground truth joined onto rated rows --------------
	computeOutcomes(loadChatMessages());
	console.log(`[backfill] outcomes written`);


	// --- vote comments -------------------------------------------------------
	if (!SKIP_VOTES) {
		const voteDone = ratedVoteIds(db);
		const comments = loadVoteComments();
		const votePending = comments
			.filter((c) => !voteDone.has(c.voteId))
			.slice(0, Number.isFinite(LIMIT) ? LIMIT : Infinity);
		console.log(`[backfill] vote comments: ${comments.length} total, ${voteDone.size} rated, ${votePending.length} pending`);
		let vSpent = 0;
		for (const c of votePending) {
			try {
				const res = await rateOne(apiKey, { key: `vote-${c.voteId}`, sender: 'voter', text: c.comment });
				insertVoteRating(db, c.voteId, res.model ?? 'typesafe/jev-1.13', parseAnswers(res.answers, 0), res.usage.cost);
				vSpent += res.usage.cost;
			} catch (err) {
				failures += 1;
				console.error(`[backfill] vote ${c.voteId} failed:`, (err as Error).message?.slice(0, 140));
			}
		}
		console.log(`[backfill] vote comments done: $${vSpent.toFixed(4)}`);
	}

	console.log(`[backfill] ALL DONE · $${spent.toFixed(4)} on chat (+ vote comments above) · ${failures} failures`);
	db.close();
}

main().catch((err) => {
	console.error('[backfill] fatal:', err);
	process.exit(1);
});
