import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { ProviderError } from '../avatarFactory/errors.js';
import type { FetchLike } from '../avatarFactory/openrouter.js';
import { assertGenerationAllowed } from '../avatarFactory/pause.js';
import { normalizeImage } from '../avatarFactory/normalize.js';
import { listLeaguesReadonly } from '../avatarFactory/roster.js';
import { normalizeBreakdown, type Breakdown } from './breakdown.js';
import { averageHash, findAlternateCovers, looksSame, readProjectAlternates, storeProjectAlternates, type AltCover } from './alternates.js';
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
import { getPinnedCoverModel, isUsablePin } from './models.js';
import { applyConcept, cleanTreatments, pitchConcepts, playerIdeas, type Concept, type ConceptMove } from './pitch.js';
import { coverFile } from './paths.js';
import { isAutoLeague, writePodiumCover } from './podium.js';
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
	if (/no generator model|no reader model|no pitch model|missing headshot|rating .* must be/i.test(msg)) {
		return { status: /rating/i.test(msg) ? 400 : 409, body: { error: msg } };
	}
	return { status: 500, body: { error: msg } };
}

const LEAGUES = ['boarz-ii-men', 'second-best', 'hip-jammers'];
const MODES = new Set(['player', 'keep', 'remove']);
export const MAX_PITCH_PLAYERS = 4;

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

export function playersFor(project: CoverProject): PlayerOption[] {
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

async function fetchCover(url: string, fetchImpl?: FetchLike): Promise<Buffer> {
	try {
		return await fetchCoverBytes(url, fetchImpl);
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

/** New project from a round submission's album art (the factory's "create from round"; also used by the auto run). */
export async function createRoundProject(db: DB, roundId: number, submissionId: number, fetchImpl?: FetchLike): Promise<CoverProject> {
	const song = (await listRoundSongs(db, roundId, fetchImpl)).find((s) => s.submissionId === submissionId);
	if (!song) throw new ApiError(404, 'submission not found in round');
	if (!song.artUrl) bad('submission has no album art');
	const rel = await saveCoverUpload(await fetchCover(song.artUrl!, fetchImpl));
	const sub = db.prepare('SELECT spotify_uri, title, artists, album FROM ml_submissions WHERE id = ?').get(submissionId) as
		| { spotify_uri: string; title: string; artists: string; album: string | null }
		| undefined;
	return createProject(db, {
		title: `${song.title} — ${song.artists}`, source: 'round', round_id: roundId,
		spotify_uri: sub?.spotify_uri ?? null, league_slug: roundLeague(db, roundId),
		cover_rel: rel, cover_url: song.artUrl,
		song_title: sub?.title ?? song.title, song_artist: sub?.artists ?? song.artists, song_album: sub?.album ?? null,
	});
}

async function actCreate(db: DB, b: Record<string, unknown>) {
	if (b.source === 'round') {
		const roundId = num(b.roundId, 'roundId');
		const submissionId = num(b.submissionId, 'submissionId');
		return { project: await createRoundProject(db, roundId, submissionId) };
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
			song_title: t.title || null, song_artist: t.artists || null, song_album: null,
		});
		return { project };
	}
	return bad('source must be round or spotify');
}

/** Cheap: one DB lookup, never touches album art or the network (runs on every project-state load). */
export function submitterFor(db: DB, project: CoverProject): { slug: string; name: string } | undefined {
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

/** Read the project's cover (paid) and store the breakdown with default treatments for its submitter. */
export async function readProject(db: DB, projectId: number, fetchImpl?: FetchLike): Promise<{ breakdown: Breakdown; treatments: Treatment[] }> {
	assertGenerationAllowed(); // the reader is a paid call too
	const project = need(db, projectId);
	const breakdown = await readCover(db, project.id, await coverDataUrl(project), { fetchImpl });
	const treatments = defaultTreatments(breakdown, submitterFor(db, project));
	updateProject(db, project.id, {
		breakdown_json: JSON.stringify(breakdown),
		treatments_json: JSON.stringify(treatments),
	});
	return { breakdown, treatments };
}

async function actRead(db: DB, b: Record<string, unknown>) {
	return readProject(db, num(b.projectId, 'projectId'));
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

/**
 * Headshots + identity descriptions for the treatments' players. A missing description is a paid
 * reader call (cached on the project); `beforeDescribe` runs right before each such call.
 */
export async function loadIdentities(
	db: DB, project: CoverProject, treatments: Treatment[],
	o: { fetchImpl?: FetchLike; beforeDescribe?: (slug: string) => void } = {},
): Promise<{ identities: Identity[]; headshots: Record<string, Buffer> }> {
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
			o.beforeDescribe?.(slug);
			features = await describeIdentity(db, project.id, (await normalizeImage(bytes!, `${slug}.jpg`)).dataUrl, { fetchImpl: o.fetchImpl });
			cache[slug] = features;
			updateProject(db, project.id, { identities_json: JSON.stringify(cache) });
		}
		identities.push({ slug, name: player!.name, features });
	}
	return { identities, headshots };
}

async function actGenerate(db: DB, b: Record<string, unknown>) {
	// Before any paid call (identity description runs ahead of generateVersion's own gate).
	assertGenerationAllowed();
	const project = need(db, num(b.projectId, 'projectId'));
	const treatments = validateTreatments(b.treatments);
	breakdownOf(project);
	if (b.modelId !== undefined && typeof b.modelId !== 'string') bad('modelId must be a string');
	if (b.promptOverride !== undefined && typeof b.promptOverride !== 'string') bad('promptOverride must be a string');
	if (typeof b.promptOverride === 'string' && b.promptOverride.length > 8000) bad('promptOverride too long (max 8000 characters)');
	// Only roster models that fit the generator job may reach the provider (no arbitrary/fal-ai ids).
	if (typeof b.modelId === 'string' && !isUsablePin(db, 'generator', b.modelId)) bad('modelId is not a usable generator model');

	const { identities, headshots } = await loadIdentities(db, project, treatments);
	const version = await generateVersion(db, {
		projectId: project.id, treatments, identities, headshots,
		modelId: b.modelId as string | undefined, promptOverride: b.promptOverride as string | undefined,
	});
	return { version, stats: projectStats(db, project.id) };
}

async function actPitch(db: DB, b: Record<string, unknown>) {
	assertGenerationAllowed(); // paid call: gate before any validation that could reach the provider
	const project = need(db, num(b.projectId, 'projectId'));
	breakdownOf(project);
	let slugs: string[];
	if (b.playerSlugs !== undefined) {
		if (!Array.isArray(b.playerSlugs) || !b.playerSlugs.every((x) => typeof x === 'string')) bad('playerSlugs must be an array of strings');
		slugs = [...new Set(b.playerSlugs as string[])];
		if (slugs.length > MAX_PITCH_PLAYERS) bad(`at most ${MAX_PITCH_PLAYERS} players per pitch`);
	} else {
		const sub = submitterFor(db, project);
		slugs = sub ? [sub.slug] : [];
	}
	if (!slugs.length) bad('choose a player');
	const players = playersFor(project);
	for (const slug of slugs) if (!players.some((p) => p.slug === slug)) bad(`unknown player ${slug}`);
	if (b.count !== undefined && (typeof b.count !== 'number' || !Number.isInteger(b.count) || b.count < 1 || b.count > 12)) {
		bad('count must be an integer 1-12');
	}
	return { concepts: await pitchConcepts(db, project.id, { playerSlugs: slugs, count: b.count as number | undefined }) };
}

async function actIdeas(db: DB, b: Record<string, unknown>) {
	assertGenerationAllowed(); // paid call
	const project = need(db, num(b.projectId, 'projectId'));
	if (typeof b.slug !== 'string' || !/^[a-z0-9-]+$/.test(b.slug)) bad('invalid player slug');
	const slug = b.slug as string;
	if (!playersFor(project).some((p) => p.slug === slug)) bad(`unknown player ${slug}`);
	return { ideas: await playerIdeas(db, project.id, slug) };
}

const MOVES: ConceptMove[] = ['morph', 'signature', 'recast', 'alternate'];

/**
 * "song — artist" -> terms. Splits on the LAST spaced em/en dash (titles can hold "Part 2 — ..."
 * and hyphens), else on the last spaced hyphen ("Song - Remix - Artist").
 */
export function parseSongQuery(q: string): { title: string; artist: string } | null {
	const s = q.trim();
	const m = /^(.+)\s+[—–]\s+(.+)$/.exec(s) ?? /^(.+)\s+-\s+(.+)$/.exec(s);
	if (!m) return null;
	const title = m[1].trim();
	const artist = m[2].trim();
	return title && artist ? { title, artist } : null;
}

async function actAlternates(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	if (b.q !== undefined && typeof b.q !== 'string') bad('q must be a string');
	const q = typeof b.q === 'string' ? b.q.trim() : '';
	let terms: { title: string; artist: string; album?: string | null } | null = null;
	if (q) {
		terms = parseSongQuery(q);
		if (!terms) bad('search as "song — artist"');
	} else if (project.song_title && project.song_artist) {
		terms = { title: project.song_title, artist: project.song_artist, album: project.song_album };
	} else {
		terms = parseSongQuery(project.title); // e.g. an upload titled "song — artist"
	}
	if (!terms) return bad('search for the song');
	const found = await findAlternateCovers(db, terms);
	const currentId = currentAlternateId(db, project);
	// A busy / no-match answer must not wipe the list the user last saw (use-alternate validates against it).
	if (found.message) return { ...found, currentId };
	// The song-keyed cache stays cover-independent; the edition that IS the current cover is dropped here
	// (unless it is the alternate in use, which stays listed as current).
	const coverHash = await currentCoverHash(db, project);
	const alternates = found.alternates.filter((a) => a.id === currentId || !a.hash || !coverHash || !looksSame(a.hash, coverHash));
	storeProjectAlternates(db, project.id, alternates);
	return { alternates, message: null, currentId };
}

/** Average hash of the project's cover file, cached per project + cover file. Null if unreadable. */
async function currentCoverHash(db: DB, project: CoverProject): Promise<string | null> {
	const key = `coverhash:${project.id}:${project.cover_rel}`;
	const row = db.prepare('SELECT json FROM cover_alt_cache WHERE key = ?').get(key) as { json: string } | undefined;
	if (row) return parseJson<string | null>(row.json, null);
	try {
		const hash = await averageHash(readFileSync(coverFile(project.cover_rel)));
		db.prepare('INSERT OR REPLACE INTO cover_alt_cache (key, json, fetched_at) VALUES (?, ?, ?)').run(key, JSON.stringify(hash), new Date().toISOString());
		return hash;
	} catch {
		return null;
	}
}

const currentKey = (projectId: number) => `current:${projectId}`;

/** Which alternate the project's cover came from (null on the original cover). */
function currentAlternateId(db: DB, project: CoverProject): string | null {
	if (!project.original_cover_rel || project.cover_rel === project.original_cover_rel) return null;
	const row = db.prepare('SELECT json FROM cover_alt_cache WHERE key = ?').get(currentKey(project.id)) as { json: string } | undefined;
	return row ? (parseJson<string | null>(row.json, null)) : null;
}

/** Download the chosen edition as a new cover file and reset everything derived from the old cover. */
async function switchCover(db: DB, project: CoverProject, alt: AltCover, fetchImpl?: FetchLike) {
	const rel = await saveCoverUpload(await fetchCover(alt.fullUrl, fetchImpl));
	const original = project.original_cover_rel ?? project.cover_rel;
	db.prepare('INSERT OR REPLACE INTO cover_alt_cache (key, json, fetched_at) VALUES (?, ?, ?)')
		.run(currentKey(project.id), JSON.stringify(alt.id), new Date().toISOString());
	return updateProject(db, project.id, {
		cover_rel: rel,
		original_cover_rel: original,
		breakdown_json: null,
		treatments_json: null,
	});
}

function pickAlternate(db: DB, project: CoverProject, id: unknown): AltCover {
	const alt = typeof id === 'string' ? readProjectAlternates(db, project.id).find((a) => a.id === id) : undefined;
	if (!alt) return bad('unknown alternate: search the alternates again');
	return alt;
}

/** Switch the project to a stored alternate edition (free; the new cover needs a fresh read). */
export async function useAlternate(db: DB, projectId: number, alternateId: unknown, fetchImpl?: FetchLike): Promise<{ project: CoverProject; unchanged: boolean }> {
	const project = need(db, projectId);
	const alt = pickAlternate(db, project, alternateId);
	// Already on this edition: keep the cover file and the read.
	if (currentAlternateId(db, project) === alt.id) return { project, unchanged: true };
	return { project: await switchCover(db, project, alt, fetchImpl), unchanged: false };
}

async function actUseAlternate(db: DB, b: Record<string, unknown>) {
	return useAlternate(db, num(b.projectId, 'projectId'), b.alternateId);
}

async function actRestoreOriginal(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	if (!project.original_cover_rel) bad('no original cover to restore');
	db.prepare('DELETE FROM cover_alt_cache WHERE key = ?').run(currentKey(project.id));
	return {
		project: updateProject(db, project.id, {
			cover_rel: project.original_cover_rel!,
			original_cover_rel: project.original_cover_rel,
			breakdown_json: null,
			treatments_json: null,
		}),
	};
}

async function actApplyConcept(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	const c = b.concept as Record<string, unknown> | undefined;
	if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id.trim()) return bad('concept required');
	if (!MOVES.includes(c.move as ConceptMove)) bad('invalid concept move');
	if (c.move === 'alternate') {
		// Free: no model call. The new cover needs a fresh read before anything can be generated.
		const alt = pickAlternate(db, project, c.alternateId);
		if (currentAlternateId(db, project) === alt.id) {
			return {
				project, unchanged: true, needsRead: !project.breakdown_json,
				breakdown: parseJson<Breakdown | null>(project.breakdown_json, null),
				treatments: parseJson<Treatment[]>(project.treatments_json, []),
			};
		}
		const updated = await switchCover(db, project, alt);
		return { project: updated, unchanged: false, needsRead: true, breakdown: null, treatments: [] };
	}
	const breakdown = breakdownOf(project);
	if (!Array.isArray(c.addSubjects)) bad('concept.addSubjects must be an array');
	const concept: Concept = {
		id: c.id,
		move: c.move as ConceptMove,
		title: String(c.title ?? ''),
		plan: String(c.plan ?? ''),
		addSubjects: normalizeBreakdown({ subjects: c.addSubjects }).subjects.map(({ conceptId: _drop, ...s }) => s),
		treatments: [],
	};
	if (!Array.isArray(c.treatments)) bad('concept.treatments must be an array');
	// The concept comes from the client: same cleaning as a model pitch, against the project's roster.
	const names = new Map(playersFor(project).map((p) => [p.slug, p.name]));
	const labels = [...breakdown.subjects.map((s) => s.label), ...concept.addSubjects.map((s) => s.label)];
	concept.treatments = cleanTreatments(c.treatments, labels, names);
	const current = parseJson<Treatment[]>(project.treatments_json, []);
	const out = applyConcept(breakdown, current, concept);
	updateProject(db, project.id, {
		breakdown_json: JSON.stringify(out.breakdown),
		treatments_json: JSON.stringify(out.treatments),
	});
	return out;
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

/** Set the project's keeper; linked podium slots become done and the round's draft is re-applied. */
export function setKeeper(db: DB, projectId: number, versionId: number): CoverProject {
	const project = need(db, projectId);
	const v = listVersions(db, project.id).find((x) => x.id === versionId);
	if (!v) throw new ApiError(404, 'version not found in project');
	if (v.status !== 'ok' || !v.image_rel) bad('a failed version cannot be the keeper');
	const updated = updateProject(db, project.id, { keeper_version_id: v.id });
	syncPodiumSlots(db, project.id, project.keeper_version_id !== v.id);
	return updated;
}

function actKeeper(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId')); // 404 before a bad versionId, as before
	return { project: setKeeper(db, project.id, num(b.versionId, 'versionId')) };
}

/**
 * A keeper on a project linked to podium slots makes those slots done and re-applies the cover to the
 * round's draft. A changed keeper drops the stale pre-rendered GIF / public share so the draft shows the
 * new keeper (promotePodiumCovers re-shares at finalize). Unlinked projects touch nothing.
 */
function syncPodiumSlots(db: DB, projectId: number, keeperChanged: boolean): void {
	const rounds = db.prepare('SELECT DISTINCT round_id FROM cover_podium_slots WHERE project_id = ?').all(projectId) as { round_id: number }[];
	if (rounds.length === 0) return;
	db.prepare(
		`UPDATE cover_podium_slots SET status = 'done', updated_at = ?,
		   gif_rel = CASE WHEN ? THEN NULL ELSE gif_rel END,
		   public_url = CASE WHEN ? THEN NULL ELSE public_url END
		 WHERE project_id = ?`,
	).run(new Date().toISOString(), keeperChanged ? 1 : 0, keeperChanged ? 1 : 0, projectId);
	for (const r of rounds) writePodiumCover(db, r.round_id);
}

async function actShare(db: DB, b: Record<string, unknown>) {
	const project = need(db, num(b.projectId, 'projectId'));
	if (project.keeper_version_id == null) bad('pick a keeper first');
	return shareKeeper(db, project.id);
}

/** Operator "run now": queue the round's automatic covers (failed slots retried); the poller runs it. */
async function actRunAuto(db: DB, b: Record<string, unknown>) {
	const roundId = num(b.roundId, 'roundId');
	if (!isAutoLeague(db, roundId)) bad('automatic covers are off for this league');
	// Dynamic: autoQueue → autoRun → service would otherwise be a load-order cycle.
	const { enqueueCoverAuto } = await import('./autoQueue.js');
	const r = enqueueCoverAuto(db, roundId, { retryFailed: true });
	if (!r) bad('no podium on the active draft');
	return r;
}

export async function runAction(db: DB, b: Record<string, unknown>): Promise<unknown> {
	switch (String(b.action ?? '')) {
		case 'create': return actCreate(db, b);
		case 'read': return actRead(db, b);
		case 'save': return actSave(db, b);
		case 'preview-prompt': return actPreview(db, b);
		case 'generate': return actGenerate(db, b);
		case 'pitch': return actPitch(db, b);
		case 'ideas': return actIdeas(db, b);
		case 'apply-concept': return actApplyConcept(db, b);
		case 'alternates': return actAlternates(db, b);
		case 'use-alternate': return actUseAlternate(db, b);
		case 'restore-original': return actRestoreOriginal(db, b);
		case 'rate': return actRate(db, b);
		case 'keeper': return actKeeper(db, b);
		case 'share': return actShare(db, b);
		case 'run-auto': return actRunAuto(db, b);
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
		// The version's own source cover; older rows (before it was recorded) fall back to the project's.
		.prepare('SELECT v.image_rel, v.status, COALESCE(v.cover_rel, p.cover_rel) AS cover_rel FROM cover_versions v JOIN cover_projects p ON p.id = v.project_id WHERE v.id = ?')
		.get(versionId) as { image_rel: string | null; status: string; cover_rel: string } | undefined;
	if (!row) throw new ApiError(404, 'version not found');
	if (row.status !== 'ok' || !row.image_rel) throw new ApiError(404, 'version has no image');
	const swapped = readFileSync(coverFile(row.image_rel));
	return ext === 'jpg' ? makeStill(swapped) : makeWipeGif(readFileSync(coverFile(row.cover_rel)), swapped);
}

export type { CoverVersion };
