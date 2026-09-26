// Builds the full boarz-stats snapshot from league.db (read-only).
// Everything returned is plain JSON-serializable.

import Database from 'better-sqlite3';
import {
	type Comp,
	type RoundInfo,
	type Sub,
	type Vote,
	type Heatmap,
	type PosPoint,
	type PositionMode,
	type SimpleStat,
	type EagernessStat,
	type SongRow,
	type ArtistRow,
	PALETTE,
	computeSpread,
	computeRoundScores,
	computeCumulative,
	computePositionsByRound,
	computeHeatmap,
	computePositionBias,
	computeContrarian,
	computeGenerosity,
	computeEagerness,
	computeSongs,
	computeArtists,
} from './stats.js';
import {
	type ChatMsg,
	type ChatAgg,
	type StarterAnchor,
	aggregateChat,
	canonicalSender,
	dayOfTs,
} from './chat.js';
import { buildDeepRatings } from './deepRatings.js';

export const DEFAULT_STATS_LEAGUE = 'boarz-ii-men';

export interface StatsSelection {
	leagueSlug?: string;
	/** Omit for the active/latest season; pass `all` for a cross-season view. */
	seasons?: number[] | 'all';
}

export interface StatsSeasonOption {
	id: number;
	number: number;
	status: 'active' | 'complete';
}

export interface Snapshot {
	generatedAt: string;
	league: {
		id: number;
		name: string;
		slug: string;
		season: string;
		selectedSeasons: number[];
		seasons: StatsSeasonOption[];
	};
	capabilities: { chat: boolean; deepRatings: boolean };
	colors: string[];
	competitors: Comp[];
	rounds: RoundInfo[];
	scores: number[][];
	cumulative: number[][];
	positions: number[][];
	subs: Sub[];
	votes: Vote[];
	heat: Heatmap;
	position: Record<PositionMode, PosPoint[]>;
	spread: { pts: number; count: number }[];
	contrarian: SimpleStat[];
	generosity: SimpleStat[];
	eagerness: EagernessStat[];
	songs: SongRow[];
	artists: ArtistRow[];
	/** Per-day ML activity vs WhatsApp chatter (local days). */
	activity: { day: string; chat: number; votes: number; voteComments: number }[];
	chat: ChatAgg;
	/** Jev deep ratings — null until the backfill script has run. */
	deep: ReturnType<typeof buildDeepRatings>;
	hype: {
		title: string;
		artist: string;
		mentions: number;
		totalPts: number | null;
		roundName: string;
		submitter: string | null;
		selfPromo: boolean;
	}[];
}

function openDb(): Database.Database {
	const dataDir = process.env.DATA_DIR ?? 'data';
	return new Database(`${dataDir}/league.db`, { readonly: true, fileMustExist: true });
}

export interface StatsLeagueSummary {
	slug: string;
	name: string;
	seasons: number[];
	activeSeason: number | null;
}

export function listStatsLeagues(): StatsLeagueSummary[] {
	const db = openDb();
	try {
		const rows = db.prepare(
			`SELECT l.slug, l.name, s.season_number, s.status
			 FROM leagues l JOIN seasons s ON s.league_id = l.id
			 ORDER BY l.name, s.season_number`
		).all() as { slug: string; name: string; season_number: number; status: string }[];
		const leagues = new Map<string, StatsLeagueSummary>();
		for (const row of rows) {
			const value = leagues.get(row.slug) ?? {
				slug: row.slug,
				name: row.name,
				seasons: [],
				activeSeason: null,
			};
			value.seasons.push(row.season_number);
			if (row.status === 'active') value.activeSeason = row.season_number;
			leagues.set(row.slug, value);
		}
		return [...leagues.values()];
	} finally {
		db.close();
	}
}

// Snapshot cache — the share instance serves many readers; recompute at most
// once a minute so page loads stay instant while data stays fresh enough.
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; snapshot: Snapshot }>();

function selectionKey(selection: StatsSelection): string {
	const seasons = selection.seasons === 'all'
		? 'all'
		: [...(selection.seasons ?? [])].sort((a, b) => a - b).join(',') || 'default';
	return `${selection.leagueSlug ?? DEFAULT_STATS_LEAGUE}:${seasons}`;
}

export function buildSnapshotCached(selection: StatsSelection = {}): Snapshot {
	const key = selectionKey(selection);
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.snapshot;
	const snapshot = buildSnapshot(selection);
	cache.set(key, { at: Date.now(), snapshot });
	return snapshot;
}

export function buildSnapshot(selection: StatsSelection = {}): Snapshot {
	const db = openDb();
	const leagueSlug = selection.leagueSlug ?? DEFAULT_STATS_LEAGUE;

	const league = db
		.prepare<[string], { id: number; slug: string; name: string }>(
			`SELECT id, slug, name FROM leagues WHERE slug = ?`
		)
		.get(leagueSlug);
	if (!league) throw new Error(`League ${leagueSlug} not found`);

	const seasonOptions = db
		.prepare<[number], { id: number; season_number: number; status: 'active' | 'complete' }>(
			`SELECT s.id, s.season_number,
				CASE
					WHEN COUNT(r.id) > 0
					 AND SUM(CASE WHEN r.voting_ended_at IS NULL THEN 1 ELSE 0 END) = 0
					THEN 'complete'
					ELSE s.status
				END status
			 FROM seasons s LEFT JOIN rounds r ON r.season_id = s.id
			 WHERE s.league_id = ?
			 GROUP BY s.id, s.season_number, s.status
			 ORDER BY s.season_number`
		)
		.all(league.id)
		.map((s) => ({ id: s.id, number: s.season_number, status: s.status }));
	if (seasonOptions.length === 0) throw new Error(`League ${leagueSlug} has no seasons`);
	const selectedNumbers = Array.isArray(selection.seasons) ? selection.seasons : [];
	const requested = selection.seasons === 'all'
		? seasonOptions
		: selectedNumbers.length
			? seasonOptions.filter((s) => selectedNumbers.includes(s.number))
			: [seasonOptions.find((s) => s.status === 'active') ?? seasonOptions.at(-1)!];
	if (requested.length === 0) throw new Error(`No matching seasons for league ${leagueSlug}`);
	const seasonIds = requested.map((s) => s.id);
	const selectedSeasonNumbers = requested.map((s) => s.number);
	const seasonPlaceholders = seasonIds.map(() => '?').join(',');

	interface RoundRow {
		id: number;
		season_number: number;
		name: string;
		t0: string | null;
		sub: string;
		vote: string;
		vend: string | null;
	}
	const roundRows = db
		.prepare(
			`SELECT r.id, s.season_number, r.name,
				COALESCE(r.round_started_at, NULL) t0,
				r.submission_deadline sub, r.voting_deadline vote, r.voting_ended_at vend
			 FROM rounds r
			 JOIN seasons s ON s.id = r.season_id
			 WHERE r.season_id IN (${seasonPlaceholders})
			 ORDER BY COALESCE(r.round_started_at, r.submission_deadline, r.voting_deadline)`
		)
		.all(...seasonIds) as RoundRow[];

	const rounds: RoundInfo[] = roundRows.map((r, idx) => ({
		id: r.id,
		idx,
		seasonNumber: r.season_number,
		name: r.name,
		// announcement time falls back to the previous round's voting end
		t0: r.t0 ?? (idx > 0 ? roundRows[idx - 1].vend : null) ?? r.sub,
		subDeadline: r.sub,
		voteDeadline: r.vote,
		votingEnded: r.vend,
	}));
	const roundIdToIdx = new Map(rounds.map((r) => [r.id, r.idx]));

	interface CompRow {
		id: number;
		name: string;
	}
	const compRows2 = db
		.prepare(
			`SELECT DISTINCT c.id, c.name
			 FROM competitors c
			 JOIN ml_submissions ms ON ms.competitor_id = c.id
			 JOIN rounds r ON ms.round_id = r.id
			 WHERE r.season_id IN (${seasonPlaceholders})
			 UNION
			 SELECT DISTINCT c.id, c.name
			 FROM competitors c
			 JOIN votes v ON v.voter_id = c.id
			 JOIN rounds r ON v.round_id = r.id
			 WHERE r.season_id IN (${seasonPlaceholders})`
		)
		.all(...seasonIds, ...seasonIds) as CompRow[];
	const competitors: Comp[] = [...compRows2].sort((a, b) => a.id - b.id);
	const compIdToIdx = new Map(competitors.map((c, i) => [c.id, i]));

	interface SubRow {
		round_id: number;
		competitor_id: number | null;
		spotify_uri: string;
		title: string;
		artists: string;
		album_art_url: string | null;
		created_at: string;
	}
	const subRows = db
		.prepare(
			`SELECT ms.round_id, ms.competitor_id, ms.spotify_uri, ms.title, ms.artists,
				ms.album_art_url, ms.created_at
			 FROM ml_submissions ms
			 JOIN rounds r ON ms.round_id = r.id
			 WHERE r.season_id IN (${seasonPlaceholders})
			 ORDER BY ms.created_at`
		)
		.all(...seasonIds) as SubRow[];

	const subs: Sub[] = [];
	for (const row of subRows) {
		const roundIdx = roundIdToIdx.get(row.round_id);
		const compIdx = row.competitor_id != null ? compIdToIdx.get(row.competitor_id) : undefined;
		if (roundIdx == null || compIdx == null) continue;
		subs.push({
			roundIdx,
			compIdx,
			uri: row.spotify_uri,
			title: row.title,
			artists: row.artists.split(/\s*[,\n]\s*/).filter(Boolean),
			art: row.album_art_url,
			createdAt: row.created_at,
			totalPts: 0,
			votesReceived: 0,
		});
	}
	const subIndex = new Map<string, number>();
	subs.forEach((s, i) => subIndex.set(`${s.roundIdx}|${s.uri}`, i));

	interface VoteRow {
		round_id: number;
		voter_id: number;
		spotify_uri: string;
		points: number;
		created_at: string;
		comment: string | null;
	}
	const voteRows = db
		.prepare(
			`SELECT v.round_id, v.voter_id, v.spotify_uri, v.points, v.created_at, v.comment
			 FROM votes v
			 JOIN rounds r ON v.round_id = r.id
			 WHERE r.season_id IN (${seasonPlaceholders})`
		)
		.all(...seasonIds) as VoteRow[];

	const votes: Vote[] = [];
	for (const row of voteRows) {
		const roundIdx = roundIdToIdx.get(row.round_id);
		const voterIdx = compIdToIdx.get(row.voter_id);
		if (roundIdx == null || voterIdx == null) continue;
		const songIdx = subIndex.get(`${roundIdx}|${row.spotify_uri}`);
		if (songIdx == null) continue;
		votes.push({ roundIdx, voterIdx, songIdx, pts: row.points, createdAt: row.created_at });
	}

	// song totals
	for (const v of votes) {
		subs[v.songIdx].totalPts += v.pts;
		subs[v.songIdx].votesReceived += 1;
	}

	const nComps = competitors.length;
	const nRounds = rounds.length;
	const scores = computeRoundScores(subs, votes, nRounds, nComps);
	const cumulative = computeCumulative(scores);
	const positions = computePositionsByRound(cumulative);
	const heat = computeHeatmap(subs, votes, nRounds, nComps);
	const spread = computeSpread(votes);
	const contrarian = computeContrarian(votes, nComps);
	const generosity = computeGenerosity(votes, nComps);
	const eagerness = computeEagerness(subs, votes, nComps);
	const songs = computeSongs(subs, rounds, competitors);
	const artists = computeArtists(songs);
	const position = {
		uri: computePositionBias(subs, 'uri'),
		chrono: computePositionBias(subs, 'chrono'),
	};

	// --- chat ----------------------------------------------------------------
	// Reuse the operator-configured league → chat mapping. Bound the messages to
	// the selected seasons so a single-season view never leaks lifetime chatter.
	let leagueGroupMap: Record<string, string> = {};
	try {
		const settings = db.prepare(`SELECT value FROM settings WHERE key = 'chat_league_group_map'`)
			.get() as { value?: string } | undefined;
		leagueGroupMap = JSON.parse(settings?.value ?? '{}') as Record<string, string>;
	} catch {
		leagueGroupMap = {};
	}
	const chatGroup = leagueGroupMap[league.slug] ?? '';
	const chatFrom = rounds[0]?.t0 ?? '';
	const finalRound = rounds.at(-1);
	const chatTo = finalRound?.votingEnded ?? finalRound?.voteDeadline ?? '';
	const chatRows = chatGroup && chatFrom && chatTo
		? db.prepare(
				`SELECT sender, text, ts FROM chat_messages
				 WHERE group_name = ? AND ts >= ? AND ts <= ? ORDER BY ts`
			).all(chatGroup, chatFrom, chatTo) as ChatMsg[]
		: [];

	const anchors: StarterAnchor[] = rounds
		.map((r, i) => [
			{ kind: 'round' as const, label: r.name, ts: r.t0 },
			...(r.votingEnded ? [{ kind: 'results' as const, label: r.name, ts: r.votingEnded }] : []),
		])
		.flat();
	const scrambleWindows = rounds.map((r) => ({
		label: r.name,
		start: new Date(new Date(r.voteDeadline).getTime() - 24 * 3600_000).toISOString(),
		end: r.voteDeadline,
	}));

	const chat = aggregateChat(chatRows, anchors, scrambleWindows, competitors);

	// ML activity vs chat, per local day: votes + vote comments alongside messages
	const voteDays = new Map<string, { v: number; c: number }>();
	for (const row of voteRows) {
		const day = dayOfTs(row.created_at);
		const e = voteDays.get(day) ?? { v: 0, c: 0 };
		e.v += 1;
		if (row.comment && row.comment.trim()) e.c += 1;
		voteDays.set(day, e);
	}
	const daySet = new Set<string>([...chat.timeline.map((t) => t.day), ...voteDays.keys()]);
	const activity = [...daySet].sort().map((day) => ({
		day,
		chat: chat.timeline.find((t) => t.day === day)?.count ?? 0,
		votes: voteDays.get(day)?.v ?? 0,
		voteComments: voteDays.get(day)?.c ?? 0,
	}));

	// --- hype / self-promo via chat_mentions ---------------------------------
	interface MentionRow {
		uri: string;
		sender: string;
	}
	const mentionRows = chatGroup && chatFrom && chatTo
		? db.prepare(
			`SELECT cs.spotify_uri uri, cm.sender_name sender
			 FROM chat_mentions cm JOIN chat_songs cs ON cs.id = cm.song_id
			 WHERE cm.chat_name = ? AND cm.captured_at >= ? AND cm.captured_at <= ?`
		)
		.all(chatGroup, chatFrom, chatTo) as MentionRow[]
		: [];

	const mentionByUri = new Map<string, { count: number; senders: Set<string> }>();
	for (const m of mentionRows) {
		const e = mentionByUri.get(m.uri) ?? { count: 0, senders: new Set<string>() };
		e.count += 1;
		e.senders.add(m.sender);
		mentionByUri.set(m.uri, e);
	}
	const selfPromoByComp = new Map<string, { count: number; songs: Set<string> }>();
	const hype = songs
		.filter((s) => mentionByUri.has(s.uri))
		.map((s) => {
			const e = mentionByUri.get(s.uri)!;
			const canonicals = [...e.senders]
				.map((snd) => canonicalSender(snd))
				.filter((c): c is string => c != null);
			const isSelf = canonicals.includes(s.compName);
			if (isSelf) {
				const acc = selfPromoByComp.get(s.compName) ?? { count: 0, songs: new Set<string>() };
				acc.count += 1;
				acc.songs.add(s.title);
				selfPromoByComp.set(s.compName, acc);
			}
			return {
				title: s.title,
				artist: s.artists[0] ?? '',
				mentions: e.count,
				totalPts: s.totalPts,
				roundName: s.roundName,
				submitter: s.compName,
				selfPromo: isSelf,
			};
		})
		.sort((a, b) => b.mentions - a.mentions);
	chat.selfPromo = [...selfPromoByComp.entries()]
		.map(([key, v]) => ({ key, count: v.count, songs: [...v.songs] }))
		.sort((a, b) => b.count - a.count);

	db.close();

	const seasonLabel = selectedSeasonNumbers.length === 1
		? `Season ${selectedSeasonNumbers[0]}`
		: `Seasons ${selectedSeasonNumbers.join(', ')}`;
	const deep = league.slug === DEFAULT_STATS_LEAGUE
		? buildDeepRatings(`${process.env.DATA_DIR ?? 'data'}/league.db`, competitors)
		: null;

	return {
		generatedAt: new Date().toISOString(),
		league: {
			id: league.id,
			name: league.name,
			slug: league.slug,
			season: seasonLabel,
			selectedSeasons: selectedSeasonNumbers,
			seasons: seasonOptions,
		},
		capabilities: { chat: chatRows.length > 0, deepRatings: deep != null },
		colors: PALETTE,
		competitors,
		rounds,
		scores,
		cumulative,
		positions,
		subs,
		votes,
		heat,
		position,
		spread,
		contrarian,
		generosity,
		eagerness,
		songs,
		artists,
		activity,
		chat,
		hype,
		deep,
	};
}
