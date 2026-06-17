import type Database from 'better-sqlite3';
import { z } from 'zod';

import { buildDeterministicSlices } from './generators/deterministic.js';
import { buildOverlap } from './generators/overlap.js';
import { generateProfile, SpectrumSliceSchema, PlaylistSliceSchema } from './generators/profile.js';
import type { ProfileSlice } from './generators/profile.js';
import {
	ACCENT_VALUES,
	SignatureSuperlativeSchema,
	SuperlativeItemSchema,
	ReelItemSchema,
	playerSuperlativesTask,
	fanHaterBlurbTask,
	leagueReelTask,
	momentLinesTask,
} from './generators/narrative.js';
import { seasonUpdateTask } from './generators/seasonUpdate.js';
import { computeSeasonSignalsForLeague } from './seasonSignals.js';
import { getSnarkLevel } from './publish.js';
import type {
	NarrativeFingerprintInput,
	PlayerSuperlativesOutput,
	FanHaterBlurbOutput,
} from './generators/narrative.js';
import { generateFingerprint } from '../predict/tasks/tasteFingerprint.js';
import type { FingerprintOutput } from '../predict/tasks/tasteFingerprint.js';
import { runPrediction } from '../predict/predict.js';

// ── Zod schemas (mirror ml-dashboard-data.jsx fixture shape) ───────────────────

export { ACCENT_VALUES };

const AccentSchema = z.enum(ACCENT_VALUES);

const SignatureArtistSchema = z.object({
	name: z.string(),
	star: z.boolean().optional(),
});

const PeerScoreSchema = z.object({
	who: z.string(),
	pct: z.number().int().min(0).max(100),
	label: z.string(),
});

const StatSchema = z.object({
	submitted: z.number().int().nonnegative(),
	avgPts: z.number().nonnegative(),
	wins: z.number().int().nonnegative(),
	bestRound: z.string().optional(),
});

const FanHaterEntrySchema = z.object({
	who: z.string(),
	pts: z.number(),
	line: z.string().optional(),
});

export const FullMemberSchema = z.object({
	id: z.string(),
	name: z.string(),
	initials: z.string(),
	hue: z.string(),
	tier: z.literal('full'),
	joined: z.string().optional(),
	headline: z.string().optional(),
	signatureArtists: z.array(SignatureArtistSchema),
	genres: z.array(z.string()),
	eras: z.array(z.string()),
	rewards: z.array(z.string()),
	punishes: z.array(z.string()),
	spectrum: SpectrumSliceSchema,
	signatureSuperlative: SignatureSuperlativeSchema,
	superlatives: z.array(SuperlativeItemSchema),
	biggestFan: FanHaterEntrySchema.optional(),
	biggestHater: FanHaterEntrySchema.optional(),
	voteTwins: z.array(PeerScoreSchema),
	voteTogether: z.array(PeerScoreSchema),
	playlist: PlaylistSliceSchema,
	stat: StatSchema,
});
export type FullMember = z.infer<typeof FullMemberSchema>;

export const LiteMemberSchema = z.object({
	id: z.string(),
	name: z.string(),
	initials: z.string(),
	hue: z.string(),
	tier: z.literal('lite'),
	joined: z.string().optional(),
	headline: z.string().optional(),
	signatureArtists: z.array(SignatureArtistSchema),
	genres: z.array(z.string()),
	eras: z.array(z.string()),
	signatureSuperlative: SignatureSuperlativeSchema,
	biggestFan: FanHaterEntrySchema.optional(),
	stat: StatSchema,
});
export type LiteMember = z.infer<typeof LiteMemberSchema>;

export const MemberSchema = z.discriminatedUnion('tier', [FullMemberSchema, LiteMemberSchema]);
export type Member = z.infer<typeof MemberSchema>;

const KpiItemSchema = z.object({
	value: z.string(),
	label: z.string(),
	sub: z.string(),
});

const MomentWithLineSchema = z.object({
	title: z.string(),
	artist: z.string(),
	submitter: z.string(),
	round: z.union([z.string(), z.number()]),
	line: z.string(),
});

const MomentsWithLinesSchema = z.object({
	mostLoved: MomentWithLineSchema,
	mostDivisive: MomentWithLineSchema,
	biggestUpset: MomentWithLineSchema,
});

export const ArchiveEntrySchema = z.object({
	n: z.number().int(),
	season: z.number().int(),
	theme: z.string(),
	winnerSong: z.string(),
	winnerArtist: z.string(),
	submitter: z.string(),
	date: z.string(),
	votes: z.number().int(),
	hue: z.string(),
	/** Public URL of the existing digest share artifact, if one has been rendered.
	 *  The b-side archive route uses this to deep-link cards → real digest pages. */
	digestUrl: z.string().nullable().optional(),
});

const LeagueMetaSchema = z.object({
	name: z.string(),
	slug: z.string().optional(),
	season: z.number().int(),
	round: z.number().int(),
	seasons: z.number().int(),
	memberCount: z.number().int(),
	updated: z.string(),
});

export const ReadModelSchema = z.object({
	league: LeagueMetaSchema,
	members: z.array(MemberSchema),
	reel: z.array(ReelItemSchema),
	kpis: z.array(KpiItemSchema),
	moments: MomentsWithLinesSchema.nullable(),
	archive: z.array(ArchiveEntrySchema),
	seasonUpdate: z.object({ title: z.string(), body: z.string() }).nullable().optional(),
});
export type ReadModel = z.infer<typeof ReadModelSchema>;

// ── Build options ───────────────────────────────────────────────────────────────

export interface BuildReadModelOpts {
	slug?: string;
}

// ── Internal helpers ────────────────────────────────────────────────────────────

function playerHue(playerId: number): string {
	const h = (playerId * 31) % 360;
	return `oklch(0.72 0.15 ${h})`;
}

function playerInitials(name: string): string {
	const parts = name.trim().split(/\s+/);
	if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
	return name.slice(0, 2).toUpperCase();
}

const DEFAULT_FP: FingerprintOutput = {
	signature_artists: [],
	genres: [],
	eras: [],
	rewards: [],
	punishes: [],
	summary: 'Limited history available.',
	confidence: 'low',
};

// ── Per-member LLM result bundle ────────────────────────────────────────────────

interface MemberLlmData {
	signatureSuperlative: PlayerSuperlativesOutput['signatureSuperlative'];
	superlatives: PlayerSuperlativesOutput['superlatives'];
	profile: ProfileSlice | null;
	fanHater: FanHaterBlurbOutput | null;
}

// ── Fingerprint load/generate ───────────────────────────────────────────────────

async function loadOrGenerateFingerprints(
	db: Database.Database,
	memberRows: { player_id: number }[],
): Promise<Map<number, FingerprintOutput>> {
	const result = new Map<number, FingerprintOutput>();
	if (memberRows.length === 0) return result;

	const phs = memberRows.map(() => '?').join(',');
	const fpRows = db
		.prepare(`SELECT player_id, taste_fingerprint FROM player_profiles WHERE player_id IN (${phs})`)
		.all(...memberRows.map((m) => m.player_id)) as {
		player_id: number;
		taste_fingerprint: string | null;
	}[];

	const existing = new Map(fpRows.map((r) => [r.player_id, r.taste_fingerprint]));

	// Generate missing fingerprints in parallel
	await Promise.all(
		memberRows
			.filter((m) => !existing.get(m.player_id))
			.map(async (m) => {
				const { fingerprint } = await generateFingerprint(db, m.player_id);
				result.set(m.player_id, fingerprint);
			}),
	);

	// Parse existing
	for (const [pid, raw] of existing) {
		if (!result.has(pid) && raw) {
			try {
				result.set(pid, JSON.parse(raw) as FingerprintOutput);
			} catch {
				// skip malformed fingerprint
			}
		}
	}
	return result;
}

// ── Archive builder ─────────────────────────────────────────────────────────────

interface ArchiveRoundRow {
	round_id: number;
	round_name: string;
	season_number: number;
	voting_deadline: string | null;
	winner_title: string | null;
	winner_artists: string | null;
	winner_player_id: number | null;
	total_votes: number;
}

function buildArchive(
	db: Database.Database,
	leagueId: number,
): z.infer<typeof ArchiveEntrySchema>[] {
	const PUBLIC_DIGEST_BASE = (
		process.env.PUBLIC_DIGEST_BASE_URL || 'https://digest.mattmariani.com'
	).replace(/\/+$/, '');

	// Per-round winner: submission with highest total points
	const winnerRows = db
		.prepare(
			`SELECT
           m.round_id,
           m.title   AS winner_title,
           m.artists AS winner_artists,
           m.player_id AS winner_player_id,
           COALESCE(SUM(v.points), 0) AS pts
         FROM ml_submissions m
         JOIN rounds r ON r.id = m.round_id
         JOIN seasons se ON se.id = r.season_id
         LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
         WHERE se.league_id = ? AND m.player_id IS NOT NULL
         GROUP BY m.id
         ORDER BY m.round_id, pts DESC`,
		)
		.all(leagueId) as {
		round_id: number;
		winner_title: string;
		winner_artists: string;
		winner_player_id: number;
		pts: number;
	}[];

	const winnerByRound = new Map<
		number,
		{ title: string; artists: string; player_id: number }
	>();
	for (const row of winnerRows) {
		if (!winnerByRound.has(row.round_id)) {
			winnerByRound.set(row.round_id, {
				title: row.winner_title,
				artists: row.winner_artists,
				player_id: row.winner_player_id,
			});
		}
	}

	// Vote counts per round
	const voteCountRows = db
		.prepare(
			`SELECT v.round_id, COUNT(*) AS total_votes
         FROM votes v
         JOIN rounds r ON r.id = v.round_id
         JOIN seasons se ON se.id = r.season_id
         WHERE se.league_id = ?
         GROUP BY v.round_id`,
		)
		.all(leagueId) as { round_id: number; total_votes: number }[];
	const votesByRound = new Map(voteCountRows.map((r) => [r.round_id, r.total_votes]));

	// Digest share slugs — lets archive cards deep-link to existing digest artifacts
	const digestShareRows = db
		.prepare(
			`SELECT ds.round_id, ds.slug
         FROM digest_shares ds
         JOIN rounds r ON r.id = ds.round_id
         JOIN seasons se ON se.id = r.season_id
         WHERE se.league_id = ?`,
		)
		.all(leagueId) as { round_id: number; slug: string }[];
	const digestSlugByRound = new Map(digestShareRows.map((r) => [r.round_id, r.slug]));

	// Completed rounds only — submission/not-started rounds have no result to archive
	const roundRows = db
		.prepare(
			`SELECT r.id AS round_id, r.name AS round_name, se.season_number, r.voting_deadline
         FROM rounds r
         JOIN seasons se ON se.id = r.season_id
         WHERE se.league_id = ? AND r.phase = 'complete'
         ORDER BY se.season_number, r.id`,
		)
		.all(leagueId) as ArchiveRoundRow[];

	const totalRounds = roundRows.length;

	// Return newest-first (reverse chronological)
	return roundRows
		.map((row, idx) => {
			const winner = winnerByRound.get(row.round_id);
			const digestSlug = digestSlugByRound.get(row.round_id);
			return {
				n: idx + 1,
				season: row.season_number,
				theme: row.round_name,
				winnerSong: winner?.title ?? '',
				winnerArtist: winner?.artists ?? '',
				submitter: winner?.player_id != null ? String(winner.player_id) : '',
				date: row.voting_deadline ?? '',
				votes: votesByRound.get(row.round_id) ?? 0,
				hue: winner?.player_id != null ? playerHue(winner.player_id) : 'oklch(0.72 0.15 0)',
				digestUrl: digestSlug ? `${PUBLIC_DIGEST_BASE}/d/${digestSlug}` : null,
			};
		})
		.reverse()
		.map((entry, i) => ({ ...entry, n: totalRounds - i }));
}

// ── Main ────────────────────────────────────────────────────────────────────────

export async function buildReadModel(
	db: Database.Database,
	leagueId: number,
	opts?: BuildReadModelOpts,
): Promise<ReadModel> {
	// 1. League existence
	const leagueRow = db.prepare('SELECT id, name FROM leagues WHERE id = ?').get(leagueId) as
		| { id: number; name: string }
		| undefined;
	if (!leagueRow) throw new Error(`League ${leagueId} not found`);

	// 2. Season + round counts
	const leagueMeta = db
		.prepare(
			`SELECT
         COUNT(DISTINCT se.id)                              AS seasonCount,
         COALESCE(MAX(se.season_number), 1)                AS latestSeason,
         COUNT(CASE WHEN r.phase = 'complete' THEN 1 END)  AS totalRounds
       FROM seasons se
       LEFT JOIN rounds r ON r.season_id = se.id
       WHERE se.league_id = ?`,
		)
		.get(leagueId) as { seasonCount: number; latestSeason: number; totalRounds: number };

	// 3. Members (players who have submitted in this league)
	const memberRows = db
		.prepare(
			`SELECT DISTINCT p.id AS player_id, p.name
       FROM players p
       JOIN competitors c ON c.player_id = p.id
       JOIN ml_submissions s ON s.competitor_id = c.id
       JOIN rounds r ON r.id = s.round_id
       JOIN seasons se ON se.id = r.season_id
       WHERE se.league_id = ?`,
		)
		.all(leagueId) as { player_id: number; name: string }[];

	if (memberRows.length === 0) {
		const readModel = {
			league: {
				name: leagueRow.name,
				season: leagueMeta.latestSeason,
				round: leagueMeta.totalRounds,
				seasons: leagueMeta.seasonCount,
				memberCount: 0,
				updated: new Date().toISOString(),
				...(opts?.slug ? { slug: opts.slug } : {}),
			},
			members: [],
			reel: [],
			kpis: [],
			moments: null,
			archive: [],
		};
		return ReadModelSchema.parse(readModel);
	}

	// 4. Deterministic slices (sync — stats, tier, fan/hater, kpis, moments)
	const { members: detMembers, league: detLeague } = buildDeterministicSlices(db, leagueId);

	// 5. Overlap v2 (sync — voteTogether + tasteTwins)
	const overlapMap = buildOverlap(db, leagueId);

	// 6. Fingerprints: load from DB, generate via LLM if missing
	const fingerprints = await loadOrGenerateFingerprints(db, memberRows);

	// 7. Per-player joined season + best round (deterministic DB queries)
	const joinedRows = db
		.prepare(
			`SELECT c.player_id, MIN(se.season_number) AS earliest_season
       FROM ml_submissions s
       JOIN competitors c ON c.id = s.competitor_id
       JOIN rounds r ON r.id = s.round_id
       JOIN seasons se ON se.id = r.season_id
       WHERE se.league_id = ? AND c.player_id IS NOT NULL
       GROUP BY c.player_id`,
		)
		.all(leagueId) as { player_id: number; earliest_season: number }[];
	const joinedMap = new Map(joinedRows.map((r) => [r.player_id, r.earliest_season]));

	const bestRoundRows = db
		.prepare(
			`SELECT sub.player_id, r.name AS round_name,
               COALESCE(SUM(v.points), 0) AS pts
         FROM ml_submissions sub
         JOIN rounds r ON r.id = sub.round_id
         JOIN seasons se ON se.id = r.season_id
         LEFT JOIN votes v ON v.round_id = sub.round_id AND v.spotify_uri = sub.spotify_uri
         WHERE se.league_id = ? AND sub.player_id IS NOT NULL
         GROUP BY sub.player_id, sub.round_id
         ORDER BY sub.player_id, pts DESC`,
		)
		.all(leagueId) as { player_id: number; round_name: string; pts: number }[];
	const bestRoundMap = new Map<number, string>();
	for (const row of bestRoundRows) {
		if (!bestRoundMap.has(row.player_id)) bestRoundMap.set(row.player_id, row.round_name);
	}

	// 8. LLM per-member — run all members in parallel
	const memberLlmResults = await Promise.all(
		memberRows.map(async (m) => {
			const det = detMembers.get(m.player_id);
			if (!det) return null;

			const fp = fingerprints.get(m.player_id) ?? DEFAULT_FP;
			const fpNarr = fp as NarrativeFingerprintInput;

			// Superlatives (all members — both full and lite get signatureSuperlative)
			const superlativesResult = await runPrediction(
				db,
				playerSuperlativesTask,
				{ playerName: m.name, leagueName: leagueRow.name, fingerprint: fpNarr, stat: det.stat },
				{ playerId: m.player_id },
			);

			// Profile (spectrum + playlist) and fan/hater blurbs in parallel — full members only
			const [profile, fanHaterResult] = await Promise.all([
				det.tier === 'full' ? generateProfile(db, m.player_id) : Promise.resolve(null),
				det.biggestFan && det.biggestHater
					? runPrediction(
							db,
							fanHaterBlurbTask,
							{
								playerName: m.name,
								leagueName: leagueRow.name,
								biggestFan: det.biggestFan,
								biggestHater: det.biggestHater,
							},
							{ playerId: m.player_id },
						)
					: Promise.resolve(null),
			]);

			const llmData: MemberLlmData = {
				signatureSuperlative: superlativesResult.output.signatureSuperlative,
				superlatives: superlativesResult.output.superlatives,
				profile,
				fanHater: fanHaterResult?.output ?? null,
			};
			return { playerId: m.player_id, llmData };
		}),
	);

	const memberLlmMap = new Map<number, MemberLlmData>(
		memberLlmResults
			.filter((r): r is NonNullable<typeof r> => r !== null)
			.map((r) => [r.playerId, r.llmData]),
	);

	// 9. League reel (LLM — league-wide superlatives)
	const fullMembersForReel = memberRows
		.filter(
			(m) => detMembers.get(m.player_id)?.tier === 'full' && fingerprints.has(m.player_id),
		)
		.map((m) => ({
			name: m.name,
			fingerprint: fingerprints.get(m.player_id)! as NarrativeFingerprintInput,
			stat: detMembers.get(m.player_id)!.stat,
		}));

	let reelItems: z.infer<typeof ReelItemSchema>[] = [];
	if (fullMembersForReel.length >= 2) {
		const reelResult = await runPrediction(db, leagueReelTask, {
			leagueName: leagueRow.name,
			season: leagueMeta.latestSeason,
			members: fullMembersForReel,
		});
		reelItems = reelResult.output.reel;
	}

	// 10. Moment lines (LLM — one celebratory caption per moment)
	let moments: z.infer<typeof MomentsWithLinesSchema> | null = null;
	if (detLeague.moments) {
		const linesResult = await runPrediction(db, momentLinesTask, {
			leagueName: leagueRow.name,
			mostLoved: detLeague.moments.mostLoved,
			mostDivisive: detLeague.moments.mostDivisive,
			biggestUpset: detLeague.moments.biggestUpset,
		});
		const lines = linesResult.output;
		moments = {
			mostLoved: { ...detLeague.moments.mostLoved, line: lines.mostLovedLine },
			mostDivisive: { ...detLeague.moments.mostDivisive, line: lines.mostDivisiveLine },
			biggestUpset: { ...detLeague.moments.biggestUpset, line: lines.biggestUpsetLine },
		};
	}

	// 11. Archive (deterministic — past rounds + winners)
	const archive = buildArchive(db, leagueId);

	// 11b. Season-update narration (LLM — only when there are signals to narrate)
	let seasonUpdate: { title: string; body: string } | null = null;
	const signals = computeSeasonSignalsForLeague(db, leagueId);
	if (signals.asOfRound && (signals.bigMover || signals.faller || signals.streaks.length > 0)) {
		const r = await runPrediction(db, seasonUpdateTask, {
			leagueName: leagueRow.name,
			season: `S${leagueMeta.latestSeason}`,
			snarkLevel: getSnarkLevel(db, leagueId),
			signals,
			recentSubjects: [],
		});
		seasonUpdate = r.output;
	}

	// 12. Assemble members
	const members: Member[] = memberRows
		.map((m): Member | null => {
			const det = detMembers.get(m.player_id);
			if (!det) return null;

			const fp = fingerprints.get(m.player_id) ?? DEFAULT_FP;
			const overlap = overlapMap.get(m.player_id) ?? { voteTogether: [], tasteTwins: [] };
			const llm = memberLlmMap.get(m.player_id);
			const joinedSeason = joinedMap.get(m.player_id);
			const bestRound = bestRoundMap.get(m.player_id);

			const signatureArtists = fp.signature_artists.map((name, idx) =>
				idx === 0 ? { name, star: true as const } : { name },
			);

			const fanEntry = det.biggestFan
				? {
						who: det.biggestFan.who,
						pts: det.biggestFan.pts,
						...(llm?.fanHater ? { line: llm.fanHater.fanLine } : {}),
					}
				: undefined;

			const haterEntry = det.biggestHater
				? {
						who: det.biggestHater.who,
						pts: det.biggestHater.pts,
						...(llm?.fanHater ? { line: llm.fanHater.haterLine } : {}),
					}
				: undefined;

			const stat = {
				submitted: det.stat.submitted,
				avgPts: det.stat.avgPts,
				wins: det.stat.wins,
				...(bestRound ? { bestRound } : {}),
			};

			const base = {
				id: String(m.player_id),
				name: m.name,
				initials: playerInitials(m.name),
				hue: playerHue(m.player_id),
				...(joinedSeason !== undefined ? { joined: `S${joinedSeason}` } : {}),
				...(fp.summary ? { headline: fp.summary } : {}),
				signatureArtists,
				genres: fp.genres,
				eras: fp.eras,
				stat,
			};

			// Full member: has profile (spectrum + playlist) from LLM
			if (det.tier === 'full' && llm?.profile) {
				return {
					...base,
					tier: 'full',
					rewards: fp.rewards,
					punishes: fp.punishes,
					spectrum: llm.profile.spectrum,
					signatureSuperlative: llm.signatureSuperlative ?? {
						award: 'League Member',
						blurb: 'A valued member of the league.',
					},
					superlatives: llm.superlatives ?? [],
					biggestFan: fanEntry,
					biggestHater: haterEntry,
					voteTwins: overlap.tasteTwins,
					voteTogether: overlap.voteTogether,
					playlist: llm.profile.playlist,
				};
			}

			// Lite member (or full member where profile LLM failed)
			return {
				...base,
				tier: 'lite',
				signatureSuperlative: llm?.signatureSuperlative ?? {
					award: 'League Member',
					blurb: 'A valued member of the league.',
				},
				biggestFan: fanEntry,
			};
		})
		.filter((m): m is Member => m !== null);

	// 13. Final assembly + zod validation
	const readModel = {
		league: {
			name: leagueRow.name,
			season: leagueMeta.latestSeason,
			round: leagueMeta.totalRounds,
			seasons: leagueMeta.seasonCount,
			memberCount: memberRows.length,
			updated: new Date().toISOString(),
			...(opts?.slug ? { slug: opts.slug } : {}),
		},
		members,
		reel: reelItems,
		kpis: detLeague.kpis,
		moments,
		archive,
		seasonUpdate,
	};

	return ReadModelSchema.parse(readModel);
}
