/**
 * storylineEvidence — deterministic evidence gathering for the Storylines
 * digest section.
 *
 * Given a round, this resolves the round's league, looks up that league's
 * `STORYLINE_SEEDS`, and for each seed searches the round's chat window
 * (`chatWindowFor`/`loadChatWindow`, voting-deadline-bounded, same as the
 * chat section) and/or that player's vote comments for the round, matching
 * on the seed's patterns. No LLM involved — the write-up consumes this
 * bundle, it doesn't produce it.
 */

import type Database from 'better-sqlite3';
import { chatWindowFor, loadChatWindow } from './chatSection';
import { buildChatRoster } from './chatRoster';
import { getChatSettings } from '../chat/historyQuery';
import { STORYLINE_SEEDS, type StorylineSeed } from './storylineSeeds';

export interface StorylineEvidence {
	player: string;
	motif: string;
	quotes: { text: string; ts: string; source: 'chat' | 'vote_comments' }[];
}

/** Cap on how many quotes back a single seed in the prompt. */
const MAX_QUOTES_PER_SEED = 5;

/** Lowercase, strip everything but letters/digits — casing/spacing-proof. */
function normalizePlayer(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface RawQuote {
	text: string;
	ts: string;
	source: 'chat' | 'vote_comments';
}

/** Newest first; stable on ties by comparing text so results are reproducible. */
function sortQuotes(quotes: RawQuote[]): RawQuote[] {
	return [...quotes].sort((a, b) => {
		const byTs = Date.parse(b.ts) - Date.parse(a.ts);
		if (byTs !== 0) return byTs;
		return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
	});
}

export function gatherStorylineEvidence(db: Database.Database, roundId: number): StorylineEvidence[] {
	const round = db
		.prepare(
			`SELECT r.id AS id, r.season_id AS seasonId, r.voting_deadline AS votingDeadline,
			        l.id AS leagueId, l.slug AS slug
			   FROM rounds r
			   JOIN seasons s ON s.id = r.season_id
			   JOIN leagues l ON l.id = s.league_id
			  WHERE r.id = ?`,
		)
		.get(roundId) as
		| { id: number; seasonId: number; votingDeadline: string | null; leagueId: number; slug: string }
		| undefined;
	if (!round) return [];

	const seeds: StorylineSeed[] = STORYLINE_SEEDS[round.slug] ?? [];
	if (seeds.length === 0) return [];

	// Previous round = the season round with the next-lower voting_deadline.
	const prevRound = round.votingDeadline
		? (db
				.prepare(
					`SELECT voting_deadline AS votingDeadline
					   FROM rounds
					  WHERE season_id = ? AND voting_deadline IS NOT NULL AND voting_deadline < ?
					  ORDER BY voting_deadline DESC LIMIT 1`,
				)
				.get(round.seasonId, round.votingDeadline) as { votingDeadline: string } | undefined)
		: undefined;

	const window = chatWindowFor(round.votingDeadline, prevRound?.votingDeadline ?? null);

	// Chat evidence is only available when there's a window AND the league has a
	// mapped chat group — either missing just means chat-sourced seeds find
	// nothing, not that the whole gatherer fails.
	let chatQuotesByPlayer = new Map<string, RawQuote[]>();
	if (window) {
		const groupName = getChatSettings(db).leagueGroupMap[round.slug];
		if (groupName) {
			const { messages, sendersSeen } = loadChatWindow(db, groupName, window);
			const roster = buildChatRoster(db, round.leagueId, sendersSeen, 'whatsapp', groupName);
			chatQuotesByPlayer = new Map();
			for (const msg of messages) {
				const person = roster.resolve(msg.sender);
				if (!person) continue;
				const key = normalizePlayer(person.name);
				const list = chatQuotesByPlayer.get(key) ?? [];
				list.push({
					text: msg.text,
					ts: new Date(msg.ts).toISOString(),
					source: 'chat',
				});
				chatQuotesByPlayer.set(key, list);
			}
		}
	}

	// Vote-comment evidence: every commented vote this round, keyed by the
	// voting competitor's name.
	const voteRows = db
		.prepare(
			`SELECT v.comment AS comment, v.created_at AS ts, c.name AS competitorName
			   FROM votes v
			   JOIN competitors c ON c.id = v.voter_id
			  WHERE v.round_id = ? AND v.comment IS NOT NULL AND TRIM(v.comment) != ''`,
		)
		.all(round.id) as { comment: string; ts: string; competitorName: string }[];
	const voteQuotesByPlayer = new Map<string, RawQuote[]>();
	for (const row of voteRows) {
		const key = normalizePlayer(row.competitorName);
		const list = voteQuotesByPlayer.get(key) ?? [];
		list.push({ text: row.comment, ts: row.ts, source: 'vote_comments' });
		voteQuotesByPlayer.set(key, list);
	}

	const evidence: StorylineEvidence[] = [];
	for (const seed of seeds) {
		const key = normalizePlayer(seed.player);
		const candidates: RawQuote[] = [];

		if (seed.sources.includes('chat')) {
			for (const q of chatQuotesByPlayer.get(key) ?? []) {
				if (seed.patterns.some((p) => p.test(q.text))) candidates.push(q);
			}
		}
		if (seed.sources.includes('vote_comments')) {
			for (const q of voteQuotesByPlayer.get(key) ?? []) {
				if (seed.patterns.some((p) => p.test(q.text))) candidates.push(q);
			}
		}

		if (candidates.length === 0) continue;

		evidence.push({
			player: seed.player,
			motif: seed.motif,
			quotes: sortQuotes(candidates).slice(0, MAX_QUOTES_PER_SEED),
		});
	}

	return evidence;
}
