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
 *
 * Attribution is by `player_id`, not by name string: `players.name` and
 * `competitors.name` frequently disagree (e.g. SSSC's `missmara` is player
 * row "Mara Mariani"), so each seed's `player` label is resolved to a
 * `player_id` once, up front, the same way `guesserInsights.ts` builds its
 * candidate roster — from the league's competitor names (via votes /
 * ml_submissions) and `player_identities` (discord + music-league) — and
 * evidence is then matched by id, never by re-comparing names downstream.
 */

import type Database from 'better-sqlite3';
import { chatWindowFor, loadChatWindow, tzOffsetMinutes, DEFAULT_CHAT_TZ } from './chatSection';
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

/**
 * Detect the chat platform actually stored for a group, instead of assuming
 * WhatsApp.
 *
 * Mirrors `+page.server.ts`'s chat-section platform detection exactly — SSSC's
 * `chat_messages` rows are all `platform='discord'`, so hardcoding 'whatsapp'
 * here made `buildChatRoster` look up the wrong `identity_type` and resolve
 * nobody, silently zeroing out every chat-sourced seed.
 */
function detectPlatform(
	db: Database.Database,
	groupName: string,
): 'whatsapp' | 'google-chat' | 'discord' {
	const raw = (
		db.prepare('SELECT platform FROM chat_messages WHERE group_name = ? LIMIT 1').get(groupName) as
			| { platform?: string }
			| undefined
	)?.platform;
	if (raw === 'googlechat') return 'google-chat';
	if (raw === 'discord') return 'discord';
	return 'whatsapp';
}

/**
 * Resolve each seed's `player` label to a `player_id`, once, for the whole
 * gather — before any evidence matching happens.
 *
 * Candidates are the league's competitor names (scoped via votes /
 * ml_submissions, same join `guesserInsights.ts` uses) and
 * `player_identities` identifiers for `discord`/`music-league` (the only
 * identity types that hold a human-readable handle rather than an opaque
 * phone/chat id) — league-scoped or global. A seed whose player can't be
 * resolved to an id is left out of the map and its evidence search is
 * skipped entirely: it cannot produce attributed evidence.
 */
function resolveSeedPlayerIds(db: Database.Database, leagueId: number): Map<string, number> {
	const byNormalizedLabel = new Map<string, number>();

	const competitorRows = db
		.prepare(
			`SELECT DISTINCT c.name AS name, c.player_id AS playerId
			   FROM competitors c
			   JOIN votes v ON v.voter_id = c.id
			   JOIN rounds r ON r.id = v.round_id
			   JOIN seasons se ON se.id = r.season_id
			  WHERE se.league_id = ? AND c.player_id IS NOT NULL
			 UNION
			 SELECT DISTINCT c.name AS name, c.player_id AS playerId
			   FROM competitors c
			   JOIN ml_submissions s ON s.competitor_id = c.id
			   JOIN rounds r ON r.id = s.round_id
			   JOIN seasons se ON se.id = r.season_id
			  WHERE se.league_id = ? AND c.player_id IS NOT NULL`,
		)
		.all(leagueId, leagueId) as { name: string; playerId: number }[];
	for (const row of competitorRows) {
		byNormalizedLabel.set(normalizePlayer(row.name), row.playerId);
	}

	const identityRows = db
		.prepare(
			`SELECT identifier, player_id AS playerId
			   FROM player_identities
			  WHERE identity_type IN ('discord', 'music-league')
			    AND (league_id = ? OR league_id IS NULL)`,
		)
		.all(leagueId) as { identifier: string; playerId: number }[];
	for (const row of identityRows) {
		byNormalizedLabel.set(normalizePlayer(row.identifier), row.playerId);
	}

	return byNormalizedLabel;
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

	const seedPlayerIds = resolveSeedPlayerIds(db, round.leagueId);

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
	const chatQuotesByPlayerId = new Map<number, RawQuote[]>();
	if (window) {
		const groupName = getChatSettings(db).leagueGroupMap[round.slug];
		if (groupName) {
			const platform = detectPlatform(db, groupName);
			const { messages, sendersSeen } = loadChatWindow(db, groupName, window);
			const roster = buildChatRoster(db, round.leagueId, sendersSeen, platform, groupName);
			for (const msg of messages) {
				const person = roster.resolve(msg.sender);
				if (!person || person.playerId === null) continue;
				const list = chatQuotesByPlayerId.get(person.playerId) ?? [];
				// msg.ts is already shifted to local wall-clock (loadChatWindow's
				// deliberate hack so downstream getUTCHours()/getUTCDay() reads
				// local time — see chatSection.ts). Re-serializing that shifted
				// value with `new Date(msg.ts).toISOString()` would stamp it "Z"
				// and mislabel it as UTC, wrong by the zone's offset. Shift back
				// to real UTC before labeling.
				const realUtcMs = msg.ts - tzOffsetMinutes(new Date(msg.ts), DEFAULT_CHAT_TZ) * 60_000;
				list.push({
					text: msg.text,
					ts: new Date(realUtcMs).toISOString(),
					source: 'chat',
				});
				chatQuotesByPlayerId.set(person.playerId, list);
			}
		}
	}

	// Vote-comment evidence: every commented vote this round, keyed by the
	// voting competitor's player_id. `votes.player_id` is the backfilled FK
	// (sprint-25); `competitors.player_id` covers rows written before that
	// backfill ran.
	const voteRows = db
		.prepare(
			`SELECT v.comment AS comment, v.created_at AS ts,
			        COALESCE(v.player_id, c.player_id) AS playerId
			   FROM votes v
			   JOIN competitors c ON c.id = v.voter_id
			  WHERE v.round_id = ? AND v.comment IS NOT NULL AND TRIM(v.comment) != ''`,
		)
		.all(round.id) as { comment: string; ts: string; playerId: number | null }[];
	const voteQuotesByPlayerId = new Map<number, RawQuote[]>();
	for (const row of voteRows) {
		if (row.playerId === null) continue;
		const list = voteQuotesByPlayerId.get(row.playerId) ?? [];
		list.push({ text: row.comment, ts: row.ts, source: 'vote_comments' });
		voteQuotesByPlayerId.set(row.playerId, list);
	}

	const evidence: StorylineEvidence[] = [];
	for (const seed of seeds) {
		const playerId = seedPlayerIds.get(normalizePlayer(seed.player));
		// Can't attribute evidence to a player we couldn't resolve.
		if (playerId === undefined) continue;

		const candidates: RawQuote[] = [];

		if (seed.sources.includes('chat')) {
			for (const q of chatQuotesByPlayerId.get(playerId) ?? []) {
				if (seed.patterns.some((p) => p.test(q.text))) candidates.push(q);
			}
		}
		if (seed.sources.includes('vote_comments')) {
			for (const q of voteQuotesByPlayerId.get(playerId) ?? []) {
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
