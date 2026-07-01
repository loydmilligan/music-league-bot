import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { updateJobs } from '$lib/content/updateJobs.js';
import { buildDeterministicSlices } from '$lib/dashboard/generators/deterministic.js';
import { buildOverlap } from '$lib/dashboard/generators/overlap.js';
import { generateProfile } from '$lib/dashboard/generators/profile.js';
import {
	playerSuperlativesTask,
	fanHaterBlurbTask,
	leagueReelTask,
	momentLinesTask,
} from '$lib/dashboard/generators/narrative.js';
import type { NarrativeFingerprintInput, SuperlativeItem } from '$lib/dashboard/generators/narrative.js';
import { runPrediction } from '$lib/predict/predict.js';
import { generateFingerprint } from '$lib/predict/tasks/tasteFingerprint.js';
import type { FingerprintOutput } from '$lib/predict/tasks/tasteFingerprint.js';
import {
	ReadModelSchema,
	ArchiveEntrySchema,
	FullMemberSchema,
	LiteMemberSchema,
} from '$lib/dashboard/buildReadModel.js';
import type { ReadModel, FullMember, LiteMember, Member } from '$lib/dashboard/buildReadModel.js';
import { writePublicArtifacts, getSnarkLevel } from '$lib/dashboard/publish.js';
import { seasonUpdateTask } from '$lib/dashboard/generators/seasonUpdate.js';
import { computeSeasonSignalsForLeague } from '$lib/dashboard/seasonSignals.js';
import { buildTasteData } from '$lib/dashboard/tasteData.js';
import { z } from 'zod';

type SectionDecision = 'refresh' | 'hold' | 'lock';
const VALID_DECISIONS = new Set<string>(['refresh', 'hold', 'lock']);
const VALID_ANNOUNCE = new Set<string>(['card', 'link', 'silent']);

const B_SIDE_BASE = (process.env.PUBLIC_DIGEST_BASE_URL ?? 'https://digest.mattmariani.com').replace(/\/+$/, '');
const PUBLIC_DIGEST_BASE = B_SIDE_BASE;

interface SiteRow {
	slug: string;
	season: number;
	archived_rounds: string;
	read_model: string;
	refreshed_at: string;
}

interface MemberRow {
	player_id: number;
	name: string;
}

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

// POST /api/content/:leagueId/update
// Body: { decisions: {section: 'refresh'|'hold'|'lock'}, steer: {section: string}, announce: 'card'|'link'|'silent' }
// Returns 202 + jobId immediately; LLM work runs async. Poll GET /update-status/:jobId for completion.
export const POST: RequestHandler = async ({ params, request }) => {
	const leagueId = Number(params.leagueId);
	if (!Number.isInteger(leagueId) || leagueId <= 0) throw error(400, 'invalid leagueId');

	let body: {
		decisions?: Record<string, string>;
		steer?: Record<string, string>;
		announce?: string;
	};
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}

	const decisions: Record<string, SectionDecision> = {};
	for (const [k, v] of Object.entries(body.decisions ?? {})) {
		if (VALID_DECISIONS.has(v)) decisions[k] = v as SectionDecision;
	}
	const steer: Record<string, string> = body.steer ?? {};
	const announce = VALID_ANNOUNCE.has(body.announce ?? '') ? body.announce! : 'card';

	const db = getDb();

	const league = db.prepare('SELECT id, name FROM leagues WHERE id = ?').get(leagueId) as
		| { id: number; name: string }
		| undefined;
	if (!league) throw error(404, `league ${leagueId} not found`);

	const site = db
		.prepare('SELECT slug, season, archived_rounds, read_model, refreshed_at FROM dashboard_sites WHERE league_id = ?')
		.get(leagueId) as SiteRow | undefined;
	if (!site) throw error(404, `league ${leagueId} has no published b-side`);

	const archivedRoundIds: number[] = JSON.parse(site.archived_rounds);
	const currentModel = JSON.parse(site.read_model) as ReadModel;
	const refreshedAt = new Date(site.refreshed_at);

	// Find the most-recent pending round: not yet in archived_rounds, OR re-finalized
	// after the site's last build (freshness-aware so re-finalized rounds surface correctly).
	const allFinalizedRows = db
		.prepare(
			`SELECT dd.round_id, r.name AS round_name, r.voting_deadline, se.season_number,
			        MAX(dd.finalized_at) AS finalized_at
			 FROM digest_drafts dd
			 JOIN rounds r ON r.id = dd.round_id
			 JOIN seasons se ON se.id = r.season_id
			 WHERE se.league_id = ? AND dd.finalized_at IS NOT NULL
			 GROUP BY dd.round_id, r.name, r.voting_deadline, se.season_number
			 ORDER BY MAX(dd.finalized_at) DESC`,
		)
		.all(leagueId) as Array<{
		round_id: number;
		round_name: string;
		voting_deadline: string | null;
		season_number: number;
		finalized_at: string;
	}>;

	const pendingRow = allFinalizedRows.find((row) => {
		const finalizedAt = new Date(row.finalized_at);
		return !archivedRoundIds.includes(row.round_id) || finalizedAt > refreshedAt;
	});

	if (!pendingRow) {
		throw error(409, 'no pending update for this league');
	}

	const jobId = crypto.randomUUID();
	updateJobs.set(jobId, { status: 'running' });

	// Fire-and-forget: all LLM work runs detached so we can return 202 immediately
	// and avoid Cloudflare's 100s proxy timeout on long multi-member generations.
	(async () => {
		try {
			// Persist decisions in dashboard_section_state
			for (const [section, decision] of Object.entries(decisions)) {
				db.prepare(
					`INSERT INTO dashboard_section_state (league_id, section, decision, steer)
					 VALUES (?, ?, ?, ?)
					 ON CONFLICT(league_id, section) DO UPDATE SET decision = excluded.decision, steer = COALESCE(excluded.steer, steer)`,
				).run(leagueId, section, decision, steer[section] ?? null);
			}
			for (const [section, steerText] of Object.entries(steer)) {
				if (!decisions[section]) {
					db.prepare(
						`INSERT INTO dashboard_section_state (league_id, section, decision, steer)
						 VALUES (?, ?, 'refresh', ?)
						 ON CONFLICT(league_id, section) DO UPDATE SET steer = excluded.steer`,
					).run(leagueId, section, steerText);
				}
			}

			const newModel = await buildUpdatedReadModel(
				db,
				leagueId,
				league.name,
				currentModel,
				decisions,
				site.slug,
			);

			const newEntry = buildArchiveEntry(db, pendingRow.round_id, pendingRow.round_name, pendingRow.season_number, 0);

			const isReArchive = archivedRoundIds.includes(pendingRow.round_id);

			let newArchive: z.infer<typeof ArchiveEntrySchema>[];
			let newArchivedRoundIds: number[];
			let newRoundCount: number;
			let archiveEntryForReshare: z.infer<typeof ArchiveEntrySchema>;

			if (isReArchive) {
				const allRoundIds = (
					db
						.prepare(
							`SELECT r.id FROM rounds r
							 JOIN seasons se ON se.id = r.season_id
							 WHERE se.league_id = ?
							 ORDER BY se.season_number, r.id`,
						)
						.all(leagueId) as { id: number }[]
				).map((r) => r.id);
				const chronoIdx = allRoundIds.indexOf(pendingRow.round_id);
				const existingN = chronoIdx >= 0 ? chronoIdx + 1 : null;

				if (existingN !== null) {
					const replacedEntry = { ...newEntry, n: existingN };
					newArchive = newModel.archive.map((e) => (e.n === existingN ? replacedEntry : e));
					archiveEntryForReshare = replacedEntry;
				} else {
					newArchive = [newEntry, ...newModel.archive].map((e, i, arr) => ({ ...e, n: arr.length - i }));
					archiveEntryForReshare = newArchive[0];
				}

				newArchivedRoundIds = archivedRoundIds;
				newRoundCount = newModel.league.round;
			} else {
				newArchive = [newEntry, ...newModel.archive].map((e, i, arr) => ({ ...e, n: arr.length - i }));
				archiveEntryForReshare = newArchive[0];
				newArchivedRoundIds = [...archivedRoundIds, pendingRow.round_id];
				newRoundCount = newModel.league.round + 1;
			}

			const finalModel: ReadModel = ReadModelSchema.parse({
				...newModel,
				archive: newArchive,
				league: {
					...newModel.league,
					round: newRoundCount,
					updated: new Date().toISOString(),
				},
			});

			const now = new Date().toISOString();

			db.prepare(
				`UPDATE dashboard_sites
				 SET read_model = ?, archived_rounds = ?, refreshed_at = ?
				 WHERE league_id = ?`,
			).run(JSON.stringify(finalModel), JSON.stringify(newArchivedRoundIds), now, leagueId);

			await writePublicArtifacts(site.slug, finalModel);

			const resharePayload = buildResharePayload(
				league.name,
				site.slug,
				pendingRow.round_id,
				pendingRow.round_name,
				announce,
				archiveEntryForReshare,
			);

			updateJobs.set(jobId, {
				status: 'done',
				result: {
					ok: true,
					slug: site.slug,
					url: `${B_SIDE_BASE}/${site.slug}`,
					archivedRoundId: pendingRow.round_id,
					reshare: resharePayload,
				},
			});
		} catch (e) {
			updateJobs.set(jobId, {
				status: 'error',
				error: e instanceof Error ? e.message : 'Update failed',
			});
		}
	})();

	return json({ jobId }, { status: 202 });
};

// ── Section-wise read_model builder ─────────────────────────────────────────

async function buildUpdatedReadModel(
	db: import('better-sqlite3').Database,
	leagueId: number,
	leagueName: string,
	currentModel: ReadModel,
	decisions: Record<string, SectionDecision>,
	slug: string,
): Promise<ReadModel> {
	const dec = (section: string): SectionDecision => decisions[section] ?? 'refresh';

	// Always run deterministic (cheap, no LLM)
	const { members: detMembers, league: detLeague } = buildDeterministicSlices(db, leagueId);
	const overlapMap = buildOverlap(db, leagueId);

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
		.all(leagueId) as MemberRow[];

	// Per-player joined season + best round
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

	// Build a map of current member data (for hold/lock sections)
	const currentMemberMap = new Map<string, Member>(
		currentModel.members.map((m) => [m.id, m]),
	);

	// Fingerprints — only load/generate if fingerprints = 'refresh'
	let fingerprintMap = new Map<number, FingerprintOutput>();
	if (dec('fingerprints') === 'refresh') {
		fingerprintMap = await loadOrGenerateFingerprints(db, memberRows);
	} else {
		// Use stored fingerprint data from current model members
		for (const row of memberRows) {
			const current = currentMemberMap.get(String(row.player_id));
			if (current) {
				fingerprintMap.set(row.player_id, memberToFingerprint(current));
			}
		}
	}

	// Per-member LLM calls
	const memberLlmResults = await Promise.all(
		memberRows.map(async (m) => {
			const det = detMembers.get(m.player_id);
			if (!det) return null;

			const fp = fingerprintMap.get(m.player_id) ?? DEFAULT_FP;
			const fpNarr = fp as NarrativeFingerprintInput;
			const currentMember = currentMemberMap.get(String(m.player_id));

			// Superlatives
			let signatureSuperlative: { award: string; blurb: string };
			let superlatives: SuperlativeItem[];
			if (dec('superlatives') === 'refresh') {
				const result = await runPrediction(
					db,
					playerSuperlativesTask,
					{ playerName: m.name, leagueName, fingerprint: fpNarr, stat: det.stat },
					{ playerId: m.player_id, category: 'archive' },
				);
				// a7: stamp prior row rejected (new row is result.meta.rowId)
				stampPredictionOutcome(db, playerSuperlativesTask.id, 'rejected', {
					playerId: m.player_id, excludeRowId: result.meta.rowId,
				});
				signatureSuperlative = result.output.signatureSuperlative;
				superlatives = result.output.superlatives;
			} else {
				// a7: hold/lock — stamp most-recent prior row passed
				stampPredictionOutcome(db, playerSuperlativesTask.id, 'passed', { playerId: m.player_id });
				signatureSuperlative = currentMember?.signatureSuperlative ?? {
					award: 'League Member',
					blurb: 'A valued member of the league.',
				};
				superlatives = currentMember && 'superlatives' in currentMember
					? (currentMember as FullMember).superlatives
					: [];
			}

			// Profile (spectrum + playlist) — full tier only, fingerprints section
			let profile: Awaited<ReturnType<typeof generateProfile>> | null = null;
			if (det.tier === 'full') {
				if (dec('fingerprints') === 'refresh') {
					profile = await generateProfile(db, m.player_id);
				} else if (currentMember && currentMember.tier === 'full') {
					profile = {
						spectrum: currentMember.spectrum,
						playlist: currentMember.playlist,
					};
				}
			}

			// Fan/hater blurbs — regenerate if either superlatives or fingerprints refresh
			let fanHaterResult: { fanLine: string; haterLine: string } | null = null;
			const shouldRefreshFanHater =
				dec('superlatives') === 'refresh' || dec('fingerprints') === 'refresh';
			if (det.biggestFan && det.biggestHater) {
				if (shouldRefreshFanHater) {
					const result = await runPrediction(
						db,
						fanHaterBlurbTask,
						{
							playerName: m.name,
							leagueName,
							biggestFan: det.biggestFan,
							biggestHater: det.biggestHater,
						},
						{ playerId: m.player_id, category: 'archive' },
					);
					// a7: stamp prior fan/hater row rejected
					stampPredictionOutcome(db, fanHaterBlurbTask.id, 'rejected', {
						playerId: m.player_id, excludeRowId: result.meta.rowId,
					});
					fanHaterResult = result.output;
				} else if (currentMember) {
					const fan = currentMember.biggestFan;
					const hater = 'biggestHater' in currentMember ? (currentMember as FullMember).biggestHater : undefined;
					if (fan?.line && hater?.line) {
						fanHaterResult = { fanLine: fan.line, haterLine: hater.line };
					}
				}
			}

			return { playerId: m.player_id, signatureSuperlative, superlatives, profile, fanHaterResult, fp };
		}),
	);

	// League reel
	let reel: ReadModel['reel'];
	if (dec('superlatives') === 'refresh') {
		const fullMembersForReel = memberRows
			.filter((m) => detMembers.get(m.player_id)?.tier === 'full' && fingerprintMap.has(m.player_id))
			.map((m) => ({
				name: m.name,
				fingerprint: fingerprintMap.get(m.player_id)! as NarrativeFingerprintInput,
				stat: detMembers.get(m.player_id)!.stat,
			}));
		if (fullMembersForReel.length >= 2) {
			const leagueMeta = db
				.prepare(`SELECT COALESCE(MAX(se.season_number), 1) AS latestSeason FROM seasons se WHERE se.league_id = ?`)
				.get(leagueId) as { latestSeason: number };
			const reelResult = await runPrediction(db, leagueReelTask, {
				leagueName,
				season: leagueMeta.latestSeason,
				members: fullMembersForReel,
			}, { category: 'archive' });
			// a7: stamp prior reel row rejected (no playerId for league-level tasks)
			stampPredictionOutcome(db, leagueReelTask.id, 'rejected', { excludeRowId: reelResult.meta.rowId });
			reel = reelResult.output.reel;
		} else {
			reel = currentModel.reel;
		}
	} else {
		reel = currentModel.reel;
	}

	// Moments
	let moments: ReadModel['moments'];
	if (dec('moments') === 'refresh' && detLeague.moments) {
		const linesResult = await runPrediction(db, momentLinesTask, {
			leagueName,
			mostLoved: detLeague.moments.mostLoved,
			mostDivisive: detLeague.moments.mostDivisive,
			biggestUpset: detLeague.moments.biggestUpset,
		}, { category: 'archive' });
		// a7: stamp prior moments row rejected
		stampPredictionOutcome(db, momentLinesTask.id, 'rejected', { excludeRowId: linesResult.meta.rowId });
		const lines = linesResult.output;
		moments = {
			mostLoved: { ...detLeague.moments.mostLoved, line: lines.mostLovedLine },
			mostDivisive: { ...detLeague.moments.mostDivisive, line: lines.mostDivisiveLine },
			biggestUpset: { ...detLeague.moments.biggestUpset, line: lines.biggestUpsetLine },
		};
	} else {
		moments = currentModel.moments;
	}

	// KPIs
	const kpis = dec('stats') === 'refresh' ? detLeague.kpis : currentModel.kpis;

	// Assemble members
	const members: Member[] = memberRows
		.map((m): Member | null => {
			const det = detMembers.get(m.player_id);
			if (!det) return null;
			const llm = memberLlmResults.find((r) => r?.playerId === m.player_id);
			if (!llm) return null;

			const fp = llm.fp;
			const overlap = dec('overlap') === 'refresh'
				? (overlapMap.get(m.player_id) ?? { voteTogether: [], tasteTwins: [] })
				: getStoredOverlap(currentMemberMap.get(String(m.player_id)));

			const joinedSeason = joinedMap.get(m.player_id);
			const bestRound = bestRoundMap.get(m.player_id);

			const signatureArtists = dec('fingerprints') === 'refresh'
				? fp.signature_artists.map((name, idx) =>
						idx === 0 ? { name, star: true as const } : { name },
					)
				: (currentMemberMap.get(String(m.player_id))?.signatureArtists ?? []);

			const fanEntry = det.biggestFan
				? {
						who: det.biggestFan.who,
						pts: det.biggestFan.pts,
						...(llm.fanHaterResult ? { line: llm.fanHaterResult.fanLine } : {}),
					}
				: undefined;

			const haterEntry = det.biggestHater
				? {
						who: det.biggestHater.who,
						pts: det.biggestHater.pts,
						...(llm.fanHaterResult ? { line: llm.fanHaterResult.haterLine } : {}),
					}
				: undefined;

			const stat = {
				submitted: det.stat.submitted,
				avgPts: det.stat.avgPts,
				wins: det.stat.wins,
				...(bestRound ? { bestRound } : {}),
			};

			const currentMember = currentMemberMap.get(String(m.player_id));
			const genres = dec('fingerprints') === 'refresh' ? fp.genres : (currentMember?.genres ?? []);
			const eras = dec('fingerprints') === 'refresh' ? fp.eras : (currentMember?.eras ?? []);
			const headline = dec('fingerprints') === 'refresh'
				? fp.summary || undefined
				: currentMember?.headline;

				const base = {
				id: String(m.player_id),
				name: m.name,
				initials: playerInitials(m.name),
				hue: playerHue(m.player_id),
				...(joinedSeason !== undefined ? { joined: `S${joinedSeason}` } : {}),
				...(headline ? { headline } : {}),
				signatureArtists,
				genres,
				eras,
				stat,
			};

			if (det.tier === 'full' && llm.profile) {
				const rewards = dec('fingerprints') === 'refresh'
					? fp.rewards
					: ((currentMember as FullMember | undefined)?.rewards ?? []);
				const punishes = dec('fingerprints') === 'refresh'
					? fp.punishes
					: ((currentMember as FullMember | undefined)?.punishes ?? []);
				return {
					...base,
					tier: 'full',
					rewards,
					punishes,
					spectrum: llm.profile.spectrum,
					signatureSuperlative: llm.signatureSuperlative,
					superlatives: llm.superlatives,
					biggestFan: fanEntry,
					biggestHater: haterEntry,
					voteTwins: overlap.tasteTwins,
					voteTogether: overlap.voteTogether,
					playlist: llm.profile.playlist,
				};
			}

			return {
				...base,
				tier: 'lite',
				signatureSuperlative: llm.signatureSuperlative,
				biggestFan: fanEntry,
			};
		})
		.filter((m): m is Member => m !== null);

	// Season meta
	const leagueMeta = db
		.prepare(
			`SELECT COALESCE(MAX(se.season_number), 1) AS latestSeason, COUNT(r.id) AS totalRounds,
			        COUNT(DISTINCT se.id) AS seasonCount
			 FROM seasons se
			 LEFT JOIN rounds r ON r.season_id = se.id
			 WHERE se.league_id = ?`,
		)
		.get(leagueId) as { latestSeason: number; totalRounds: number; seasonCount: number };

	// Season-update narration — regenerate on every update, suppress prior subjects.
	let seasonUpdate: { title: string; body: string } | null = null;
	const signals = computeSeasonSignalsForLeague(db, leagueId);
	if (signals.asOfRound && (signals.bigMover || signals.faller || signals.streaks.length > 0)) {
		const priorSubjects = currentModel.seasonUpdate
			? [...signals.punchingBagGuard]
			: [];
		const r = await runPrediction(db, seasonUpdateTask, {
			leagueName,
			season: `S${leagueMeta.latestSeason}`,
			snarkLevel: getSnarkLevel(db, leagueId),
			signals,
			recentSubjects: priorSubjects,
		}, { category: 'archive' });
		// a7: stamp prior season-update row rejected
		stampPredictionOutcome(db, seasonUpdateTask.id, 'rejected', { excludeRowId: r.meta.rowId });
		seasonUpdate = r.output;
	}

	const taste = buildTasteData(db, memberRows.map((m) => ({ player_id: m.player_id, name: m.name })));

	return ReadModelSchema.parse({
		league: {
			name: leagueName,
			id: leagueId,
			slug,
			season: leagueMeta.latestSeason,
			round: leagueMeta.totalRounds,
			seasons: leagueMeta.seasonCount,
			memberCount: memberRows.length,
			updated: new Date().toISOString(),
		},
		members,
		reel,
		kpis,
		moments,
		archive: currentModel.archive, // archive updated by caller
		seasonUpdate,
		taste,
	});
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadOrGenerateFingerprints(
	db: import('better-sqlite3').Database,
	memberRows: MemberRow[],
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

	await Promise.all(
		memberRows
			.filter((m) => !existing.get(m.player_id))
			.map(async (m) => {
				const { fingerprint } = await generateFingerprint(db, m.player_id);
				result.set(m.player_id, fingerprint);
			}),
	);

	for (const [pid, raw] of existing) {
		if (!result.has(pid) && raw) {
			try {
				result.set(pid, JSON.parse(raw) as FingerprintOutput);
			} catch {
				// skip malformed
			}
		}
	}
	return result;
}

function memberToFingerprint(member: Member): FingerprintOutput {
	return {
		signature_artists: member.signatureArtists.map((a) => a.name),
		genres: member.genres,
		eras: member.eras,
		rewards: 'rewards' in member ? (member as FullMember).rewards : [],
		punishes: 'punishes' in member ? (member as FullMember).punishes : [],
		summary: member.headline ?? '',
		confidence: 'medium',
	};
}

function getStoredOverlap(
	member: Member | undefined,
): { voteTogether: Array<{who: string; pct: number; label: string}>; tasteTwins: Array<{who: string; pct: number; label: string}> } {
	if (!member || member.tier !== 'full') {
		return { voteTogether: [], tasteTwins: [] };
	}
	return {
		voteTogether: (member as FullMember).voteTogether,
		tasteTwins: (member as FullMember).voteTwins,
	};
}

function buildArchiveEntry(
	db: import('better-sqlite3').Database,
	roundId: number,
	roundName: string,
	seasonNumber: number,
	n: number,
): z.infer<typeof ArchiveEntrySchema> {
	const PUBLIC_DIGEST_BASE_URL = (process.env.PUBLIC_DIGEST_BASE_URL ?? 'https://digest.mattmariani.com').replace(/\/+$/, '');

	const winnerRow = db
		.prepare(
			`SELECT sub.title, sub.artists, sub.player_id,
			        COALESCE(SUM(v.points), 0) AS pts
			 FROM ml_submissions sub
			 LEFT JOIN votes v ON v.round_id = sub.round_id AND v.spotify_uri = sub.spotify_uri
			 WHERE sub.round_id = ? AND sub.player_id IS NOT NULL
			 GROUP BY sub.id
			 ORDER BY pts DESC
			 LIMIT 1`,
		)
		.get(roundId) as { title: string; artists: string; player_id: number; pts: number } | undefined;

	const voteCount = (
		db.prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?').get(roundId) as { n: number }
	).n;

	const votingDeadline = (
		db.prepare('SELECT voting_deadline FROM rounds WHERE id = ?').get(roundId) as { voting_deadline: string | null }
	)?.voting_deadline;

	const digestShare = db
		.prepare('SELECT slug FROM digest_shares WHERE round_id = ?')
		.get(roundId) as { slug: string } | undefined;

	return {
		n,
		season: seasonNumber,
		theme: roundName,
		winnerSong: winnerRow?.title ?? '',
		winnerArtist: winnerRow?.artists ?? '',
		submitter: winnerRow?.player_id != null ? String(winnerRow.player_id) : '',
		date: votingDeadline ?? '',
		votes: voteCount,
		hue: winnerRow?.player_id != null
			? `oklch(0.72 0.15 ${(winnerRow.player_id * 31) % 360})`
			: 'oklch(0.72 0.15 0)',
		digestUrl: digestShare ? `${PUBLIC_DIGEST_BASE_URL}/d/${digestShare.slug}` : null,
	};
}

/**
 * a7: fire-and-forget outcome stamp on a prediction_runs row.
 * For 'refresh' sections: stamp the PRIOR row (before the new rowId) rejected.
 * For 'hold'/'lock' sections: stamp the most-recent existing row passed.
 * Never throws — ledger write failures must not abort the archive update.
 */
function stampPredictionOutcome(
	db: import('better-sqlite3').Database,
	taskId: string,
	outcome: 'rejected' | 'passed',
	opts: { playerId?: number; excludeRowId?: string },
): void {
	try {
		const RECOVERY_COST: Record<string, number> = { passed: 0.0, rejected: 0.9 };
		const recoveryCost = RECOVERY_COST[outcome] ?? 0.0;
		// Find the most-recent row for this task, optionally excluding the just-inserted row
		const playerClause = opts.playerId != null ? 'AND player_id = ?' : 'AND player_id IS NULL';
		const excludeClause = opts.excludeRowId ? 'AND id != ?' : '';
		const rowArgs: unknown[] = [taskId];
		if (opts.playerId != null) rowArgs.push(opts.playerId);
		if (opts.excludeRowId) rowArgs.push(opts.excludeRowId);
		const row = db
			.prepare(
				`SELECT id FROM prediction_runs
				 WHERE task_id = ? ${playerClause} ${excludeClause}
				 ORDER BY created_at DESC LIMIT 1`,
			)
			.get(...rowArgs) as { id: string } | undefined;
		if (!row) return; // no prior row to stamp
		db.prepare(
			`UPDATE prediction_runs SET outcome = ?, recovery_cost = ? WHERE id = ?`,
		).run(outcome, recoveryCost, row.id);
	} catch { /* fire-and-forget */ }
}

function buildResharePayload(
	leagueName: string,
	siteSlug: string,
	roundId: number,
	roundName: string,
	announce: string,
	archiveEntry: z.infer<typeof ArchiveEntrySchema>,
) {
	const url = `${B_SIDE_BASE}/${siteSlug}`;
	if (announce === 'silent') return { mode: 'silent', url };

	const headline = 'NEW IN THE ARCHIVE';
	const blurb = `Round ${archiveEntry.n} just landed — "${roundName}"${archiveEntry.winnerSong ? `, won by ${archiveEntry.submitter}` : ''}. The archive and season stats are updated.`;
	const cardText = `the b/side\n${headline}\nRound ${archiveEntry.n} — "${roundName}"\n${blurb}\n🔒 ${url}`;
	const linkText = url;

	return {
		mode: announce,
		url,
		cardText: announce === 'card' ? cardText : undefined,
		linkText: announce !== 'silent' ? linkText : undefined,
		headline,
		blurb,
	};
}
