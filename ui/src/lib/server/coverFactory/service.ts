import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { ProviderError } from '../avatarFactory/errors.js';
import { assertGenerationAllowed } from '../avatarFactory/pause.js';
import { normalizeImage } from '../avatarFactory/normalize.js';
import { listLeaguesReadonly } from '../avatarFactory/roster.js';
import { normalizeBreakdown, type Breakdown } from './breakdown.js';
import { generateVersion } from './generate.js';
import {
	fetchCoverBytes,
	listPlayers,
	listRoundSongs,
	submitterOfSubmission,
	loadHeadshot,
	resolveSpotifyCover,
	saveCoverUpload,
	saveHeadshotUpload,
	type PlayerOption,
} from './inputs.js';
import { getPinnedCoverModel } from './models.js';
import { coverFile } from './paths.js';
import { buildSwapPrompt, defaultTreatments, type Identity, type Treatment } from './prompt.js';
import { describeIdentity, readCover } from './reader.js';
import {
	createProject,
	getProject,
	listProjects,
	listVersions,
	projectStats,
	rateVersion,
	updateProject,
	type CoverProject,
	type CoverVersion,
} from './repo.js';
import { shareKeeper } from './share.js';
import { makeStill, makeWipeGif } from './wipe.js';

type DB = Database.Database;

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly reason?: string,
	) {
		super(message);
	}
}

/** Map any thrown value to a JSON-able status + body. */
export function toApiError(e: unknown): { status: number; body: { error: string; reason?: string } } {
	if (e instanceof ApiError) return { status: e.status, body: { error: e.message, ...(e.reason ? { reason: e.reason } : {}) } };
	if (e instanceof ProviderError) return { status: 502, body: { error: e.userMessage, reason: e.reason } };
	const msg = e instanceof Error ? e.message : 'error';
	if (/paused/i.test(msg)) return { status: 409, body: { error: msg, reason: 'paused' } };
	if (/not found/i.test(msg)) return { status: 404, body: { error: msg } };
	if (/no generator model|no reader model|missing headshot|rating .* must be/i.test(msg)) {
		return { status: /rating/i.test(msg) ? 400 : 409, body: { error: msg } };
	}
	return { status: 500, body: { error: msg } };
}

const LEAGUES = ['boarz-ii-men', 'second-best', 'hip-jammers'];
const MODES = new Set(['player', 'keep', 'remove']);

const bad = (msg: string): never => {
	throw new ApiError(400, msg);
};

function num(v: unknown, name: string): number {
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) bad(`${name} required`);
	return n;
}

function need(db: DB, projectId: number): CoverProject {
	const p = getProject(db, projectId);
	if (!p) throw new ApiError(404, `cover project ${projectId} not found`);
	return p;
}

function parseJson<T>(s: string | null, fallback: T): T {
	if (!s) return fallback;
	try {
		return JSON.parse(s) as T;
	} catch {
		return fallback;
	}
}

function playersFor(project: CoverProject): PlayerOption[] {
	if (project.league_slug) return listPlayers(project.league_slug, project.id);
	return LEAGUES.flatMap((l) => listPlayers(l, project.id));
}

export function validateTreatments(raw: unknown): Treatment[] {
	if (!Array.isArray(raw)) return bad('treatments must be an array');
	return (raw as unknown[]).map((t) => {
		const o = t as Record<string, unknown>;
		if (!o || typeof o !== 'object' || typeof o.label !== 'string' || !MODES.has(String(o.mode))) {
			return bad('invalid treatment');
		}
		if (o.mode === 'player' && typeof o.playerSlug !== 'string') return bad(`treatment "${o.label}" needs a player`);
		return o as unknown as Treatment;
	});
}

// ---------- GET ----------

/** Attach each version's generate-call cost and latency (from cover_requests) for the version strip. */
function withGenerateCost(db: DB, projectId: number, versions: CoverVersion[]) {
	const rows = db
		.prepare(
			`SELECT version_id, SUM(cost_usd) AS cost_usd, MAX(cost_estimated) AS cost_estimated, SUM(latency_ms) AS latency_ms
			 FROM cover_requests WHERE project_id = ? AND step = 'generate' AND version_id IS NOT NULL GROUP BY version_id`,
		)
		.all(projectId) as { version_id: number; cost_usd: number | null; cost_estimated: number; latency_ms: number }[];
	const by = new Map(rows.map((r) => [r.version_id, r]));
	return versions.map((v) => {
		const r = by.get(v.id);
		return { ...v, cost_usd: r?.cost_usd ?? null, cost_estimated: r?.cost_estimated ?? 0, latency_ms: r?.latency_ms ?? null };
	});
}

export async function getState(db: DB, q: URLSearchParams): Promise<unknown> {
	const projectParam = q.get('project');
	if (projectParam) {
		const project = need(db, num(projectParam, 'project'));
		return {
			project,
			breakdown: parseJson<Breakdown | null>(project.breakdown_json, null),
			treatments: parseJson<Treatment[]>(project.treatments_json, []),
			versions: withGenerateCost(db, project.id, listVersions(db, project.id)),
			stats: projectStats(db, project.id),
			players: playersFor(project),
			submitter: submitterFor(db, project) ?? null,
		};
	}
	const league = q.get('league');
	if (league) {
		const round = q.get('round');
		if (round) return { songs: await listRoundSongs(db, num(round, 'round')) };
		const rounds = db
			.prepare(
				`SELECT r.id, r.name, (SELECT COUNT(*) FROM ml_submissions m WHERE m.round_id = r.id) AS songCount
				 FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id
				 WHERE l.slug = ? ORDER BY r.id DESC LIMIT 100`,
			)
			.all(league) as { id: number; name: string; songCount: number }[];
		// rounds has no per-league number column; the round id is the number used everywhere else (R182 etc.).
		// songCount lets the picker skip future/in-progress rounds that have no submissions yet.
		return {
			players: listPlayers(league),
			rounds: rounds.map((r) => ({ id: r.id, name: r.name, number: r.id, songCount: r.songCount })),
		};
	}
	return {
		projects: listProjects(db),
		leagues: listLeaguesReadonly(),
		models: { reader: getPinnedCoverModel(db, 'reader'), generator: getPinnedCoverModel(db, 'generator') },
	};
}

// ---------- POST ----------

async function fetchCover(url: string): Promise<Buffer> {
	try {
		return await fetchCoverBytes(url);
	} catch (e) {
		throw new ApiError(400, e instanceof Error ? e.message : 'cover fetch failed');
	}
}

function roundLeague(db: DB, roundId: number): string | null {
	const r = db
		.prepare(
			`SELECT l.slug FROM rounds r JOIN seasons s ON s.id = r.season_id JOIN leagues l ON l.id = s.league_id WHERE r.id = ?`,
		)
		.get(roundId) as { slug: string } | undefined;
	return r?.slug ?? null;
}

async function actCreate(db: DB, b: Record<string, unknown>) {
	if (b.source === 'round') {
		const roundId = num(b.roundId, 'roundId');
		const submissionId = num(b.submissionId, 'submissionId');
		const song = (await listRoundSongs(db, roundId)).find((s) => s.submissionId === submissionId);
		if (!song) throw new ApiError(404, 'submission not found in round');
		if (!song.artUrl) bad('submission has no album art');
		const rel = await saveCoverUpload(await fetchCover(song.artUrl!));
		const uri = db.prepare('SELECT spotify_uri FROM ml_submissions WHERE id = ?').get(submissionId) as { spotify_uri: string } | undefined;
		const project = createProject(db, {
			title: `${song.title} — ${song.artists}`, source: 'round', round_id: roundId,
			spotify_uri: uri?.spotify_uri ?? null, league_slug: roundLeague(db, roundId),
			cover_rel: rel, cover_url: song.artUrl,
		});
		return { project };
	}
	if (b.source === 'spotify') {
		const url = typeof b.url === 'string' ? b.url : bad('url required');
		let t;
		try {
			t = await resolveSpotifyCover(url);
		} catch (e) {
			const m = e instanceof Error ? e.message : 'spotify lookup failed';
			throw new ApiError(/not a Spotify|no album art/i.test(m) ? 400 : 502, m);
		}
		const rel = await saveCoverUpload(await fetchCover(t.artUrl));
		const project = createProject(db, {
			title: t.artists ? `${t.title} — ${t.artists}` : t.title || 'Spotify cover', source: 'spotify', round_id: null, spotify_uri: t.spotifyUri,
			league_slug: null, cover_rel: rel, cover_url: t.artUrl,
		});
		return { project };
	}
	return bad('source must be round or spotify');
}

/** Cheap: one DB lookup, never touches album art or the network (runs on every project-state load). */
function submitterFor(db: DB, project: CoverProject): { slug: string; name: string } | undefined {
	if (project.round_id == null || !project.spotify_uri) return undefined;
	const sub = db
		.prepare('SELECT id FROM ml_submissions WHERE round_id = ? AND spotify_uri = ? LIMIT 1')
		.get(project.round_id, project.spotify_uri) as { id: number } | undefined;
	if (!sub) return undefined;
	return submitterOfSubmission(db, sub.id);
}

async function coverDataUrl(project: CoverProject): Promise<string> {
	return (await normalizeImage(readFileSync(coverFile(project.cover_rel)), 'cover.jpg')).dataUrl;
}

async function actRead(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	const breakdown = await readCover(db, project.id, await coverDataUrl(project));
	const treatments = defaultTreatments(breakdown, submitterFor(db, project));
	updateProject(db, project.id, {
		breakdown_json: JSON.stringify(breakdown),
		treatments_json: JSON.stringify(treatments),
	});
	return { breakdown, treatments };
}

function actSave(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	const patch: Parameters<typeof updateProject>[2] = {};
	if (b.breakdown !== undefined) {
		try {
			patch.breakdown_json = JSON.stringify(normalizeBreakdown(b.breakdown));
		} catch (e) {
			bad(e instanceof Error ? e.message : 'invalid breakdown');
		}
	}
	if (b.treatments !== undefined) patch.treatments_json = JSON.stringify(validateTreatments(b.treatments));
	return { project: updateProject(db, project.id, patch) };
}

function breakdownOf(project: CoverProject): Breakdown {
	if (!project.breakdown_json) throw new ApiError(409, 'read the cover first');
	return normalizeBreakdown(JSON.parse(project.breakdown_json));
}

function playerSlugs(ts: Treatment[]): string[] {
	return [...new Set(ts.filter((t) => t.mode === 'player' && t.playerSlug).map((t) => t.playerSlug as string))];
}

function actPreview(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	const treatments = validateTreatments(b.treatments);
	const cache = parseJson<Record<string, string>>(project.identities_json, {});
	const players = playersFor(project);
	const ids: Identity[] = playerSlugs(treatments).map((slug) => ({
		slug,
		name: players.find((p) => p.slug === slug)?.name ?? slug,
		features: cache[slug] ?? '(identity description is generated from the headshot when you generate)',
	}));
	return { prompt: buildSwapPrompt(breakdownOf(project), treatments, ids).prompt };
}

async function actGenerate(db: DB, b: Record<string, unknown>) {
	// Before any paid call (identity description runs ahead of generateVersion's own gate).
	assertGenerationAllowed();
	const project = need(db, num(b.projectId, 'projectId'));
	const treatments = validateTreatments(b.treatments);
	breakdownOf(project);
	if (b.modelId !== undefined && typeof b.modelId !== 'string') bad('modelId must be a string');
	if (b.promptOverride !== undefined && typeof b.promptOverride !== 'string') bad('promptOverride must be a string');

	const players = playersFor(project);
	const cache = parseJson<Record<string, string>>(project.identities_json, {});
	const identities: Identity[] = [];
	const headshots: Record<string, Buffer> = {};
	for (const slug of playerSlugs(treatments)) {
		const player = players.find((p) => p.slug === slug);
		if (!player) bad(`unknown player ${slug}`);
		const bytes = await loadHeadshot(project.id, player!);
		if (!bytes) bad(`missing headshot for ${player!.name}`);
		headshots[slug] = bytes!;
		let features = cache[slug];
		if (!features) {
			features = await describeIdentity(db, project.id, (await normalizeImage(bytes!, `${slug}.jpg`)).dataUrl);
			cache[slug] = features;
			updateProject(db, project.id, { identities_json: JSON.stringify(cache) });
		}
		identities.push({ slug, name: player!.name, features });
	}
	const version = await generateVersion(db, {
		projectId: project.id, treatments, identities, headshots,
		modelId: b.modelId as string | undefined, promptOverride: b.promptOverride as string | undefined,
	});
	return { version, stats: projectStats(db, project.id) };
}

function actRate(db: DB, b: Record<string, unknown>) {
	const id = num(b.versionId, 'versionId');
	const r = b.ratings;
	if (!r || typeof r !== 'object' || Array.isArray(r)) bad('ratings required');
	const ratings: Record<string, number | null> = {};
	for (const k of ['likeness', 'seamlessness', 'gag', 'instructions']) {
		const v = (r as Record<string, unknown>)[k];
		if (v === undefined) continue;
		if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5)) bad(`rating ${k} must be an integer 1-5 or null`);
		ratings[k] = v as number | null;
	}
	if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') bad('note must be a string');
	return { version: rateVersion(db, id, ratings, b.note as string | null | undefined) };
}

function actKeeper(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	const v = listVersions(db, project.id).find((x) => x.id === num(b.versionId, 'versionId'));
	if (!v) throw new ApiError(404, 'version not found in project');
	if (v.status !== 'ok' || !v.image_rel) bad('a failed version cannot be the keeper');
	return { project: updateProject(db, project.id, { keeper_version_id: v.id }) };
}

async function actShare(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	if (project.keeper_version_id == null) bad('pick a keeper first');
	return shareKeeper(db, project.id);
}

export async function runAction(db: DB, b: Record<string, unknown>): Promise<unknown> {
	switch (String(b.action ?? '')) {
		case 'create': return actCreate(db, b);
		case 'read': return actRead(db, b);
		case 'save': return actSave(db, b);
		case 'preview-prompt': return actPreview(db, b);
		case 'generate': return actGenerate(db, b);
		case 'rate': return actRate(db, b);
		case 'keeper': return actKeeper(db, b);
		case 'share': return actShare(db, b);
		default: return bad('unknown action');
	}
}

export async function runUpload(db: DB, form: FormData): Promise<unknown> {
	const file = form.get('file');
	if (!(file instanceof File)) bad('file required');
	const bytes = Buffer.from(await (file as File).arrayBuffer());
	const action = String(form.get('action') ?? '');
	if (action !== 'upload-cover' && action !== 'upload-headshot') return bad('unknown action');
	// Only an undecodable image is a client error; disk/DB failures must surface as 5xx.
	try {
		await normalizeImage(bytes, 'upload.jpg');
	} catch {
		throw new ApiError(400, 'not a valid image');
	}
	if (action === 'upload-cover') {
		const rel = await saveCoverUpload(bytes);
		const league = form.get('leagueSlug');
		const title = String(form.get('title') ?? '').trim() || (file as File).name.replace(/\.[^.]+$/, '') || 'Uploaded cover';
		return {
			project: createProject(db, {
				title, source: 'upload', round_id: null, spotify_uri: null,
				league_slug: typeof league === 'string' && league ? league : null, cover_rel: rel, cover_url: null,
			}),
		};
	}
	const project = need(db, num(form.get('projectId'), 'projectId'));
	const slug = String(form.get('slug') ?? '');
	if (!/^[a-z0-9-]+$/.test(slug)) bad('invalid player slug');
	const rel = await saveHeadshotUpload(project.id, slug, bytes);
	// A new headshot invalidates that player's cached identity description.
	const cache = parseJson<Record<string, string>>(project.identities_json, {});
	if (cache[slug]) {
		delete cache[slug];
		updateProject(db, project.id, { identities_json: JSON.stringify(cache) });
	}
	return { rel, players: playersFor(need(db, project.id)) };
}

/** Download variants built on the fly: still JPEG or wipe GIF for one version. */
export async function buildExport(db: DB, versionId: number, ext: 'gif' | 'jpg'): Promise<Buffer> {
	const row = db
		.prepare('SELECT v.image_rel, v.status, p.cover_rel FROM cover_versions v JOIN cover_projects p ON p.id = v.project_id WHERE v.id = ?')
		.get(versionId) as { image_rel: string | null; status: string; cover_rel: string } | undefined;
	if (!row) throw new ApiError(404, 'version not found');
	if (row.status !== 'ok' || !row.image_rel) throw new ApiError(404, 'version has no image');
	const swapped = readFileSync(coverFile(row.image_rel));
	return ext === 'jpg' ? makeStill(swapped) : makeWipeGif(readFileSync(coverFile(row.cover_rel)), swapped);
}

export type { CoverVersion };
