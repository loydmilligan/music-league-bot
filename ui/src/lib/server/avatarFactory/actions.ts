import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { allocateVersionedPath, assertSlug, slugify } from './filenames.js';
import { canRequestGroupShot, clampOptionCount, optionLetters } from './gating.js';
import { GLOBAL_NOTES } from './notes.js';
import { fileToDataUrl, generateOpenRouterImage, type FetchLike } from './openrouter.js';
import { assertGenerationAllowed, isGenerationPaused, PAUSED_MESSAGE } from './pause.js';
import { DEFAULT_PROVIDER, listProviders, resolveProvider } from './providers.js';
import { factoryRoot, isImageName, PathGuardError, resolveUnderRoot, sourcesRoot } from './paths.js';
import { assembleAvatarPrompt, assembleGroupShotPrompt } from './prompts.js';
import { readInspirationAbs, readNotesMd, rescanSources } from './seed.js';
import {
	approvedForTheme,
	ensureLeague,
	findMember,
	imagesRoot,
	loadState,
	newId,
	photosRoot,
	saveState,
	type CandidateRecord,
	type FactoryState,
	type ThemeRecord,
} from './store.js';
import { listLeaguesReadonly, readRoster } from './roster.js';

const MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif',
};

export interface FactoryCtx {
	factoryDir?: string;
	sourcesDir?: string;
	fetchImpl?: FetchLike;
}

function roots(ctx: FactoryCtx) {
	const factoryDir = ctx.factoryDir ?? factoryRoot();
	const sourcesDir = ctx.sourcesDir ?? sourcesRoot();
	return { factoryDir, sourcesDir, img: imagesRoot(factoryDir) };
}

function mimeFor(path: string): string {
	return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function dataUrlFromFile(abs: string): string {
	return fileToDataUrl(readFileSync(abs), mimeFor(abs));
}

export function publicState(leagueSlug: string, ctx: FactoryCtx = {}) {
	const { factoryDir } = roots(ctx);
	const state = loadState(factoryDir);
	if (!state.leagues[leagueSlug] && !state.themes.length) {
		rescanSources({ factoryDir, sourcesDir: ctx.sourcesDir ?? sourcesRoot() });
	}
	const fresh = loadState(factoryDir);
	const roster = readRoster(leagueSlug);
	if (roster) {
		const league = ensureLeague(fresh, roster.slug, roster.name);
		for (const m of roster.members) {
			if (!findMember(league, m.slug)) {
				league.members.push({
					slug: m.slug,
					name: m.name,
					playerId: m.playerId,
					height: 'medium',
					notes: '',
					photoRel: null,
					candidates: [],
				});
			}
		}
		saveState(fresh, factoryDir);
	}
	const league = fresh.leagues[leagueSlug] ?? { slug: leagueSlug, name: leagueSlug, members: [], groupShots: [] };
	const leagues = listLeaguesReadonly();
	if (leagues.length === 0) {
		leagues.push(...Object.values(fresh.leagues).map((l) => ({ slug: l.slug, name: l.name })));
	} else if (league.slug && !leagues.some((l) => l.slug === league.slug)) {
		leagues.push({ slug: league.slug, name: league.name });
	}

	return {
		leagues,
		themes: fresh.themes,
		league,
		costUsd: fresh.costUsd,
		attemptCount: fresh.attemptCount,
		sourcesConfigured: existsSync(ctx.sourcesDir ?? sourcesRoot()),
		generationPaused: isGenerationPaused(),
		pausedMessage: isGenerationPaused() ? PAUSED_MESSAGE : null,
		providers: listProviders(),
		defaultProvider: DEFAULT_PROVIDER,
	};
}

export function runRescan(ctx: FactoryCtx = {}) {
	return rescanSources({ factoryDir: ctx.factoryDir ?? factoryRoot(), sourcesDir: ctx.sourcesDir ?? sourcesRoot() });
}

export function setMemberNotes(leagueSlug: string, memberSlug: string, notes: string, ctx: FactoryCtx = {}) {
	const { factoryDir } = roots(ctx);
	const state = loadState(factoryDir);
	const member = requireMember(state, leagueSlug, memberSlug);
	member.notes = notes;
	saveState(state, factoryDir);
	return member;
}

export function setRating(
	leagueSlug: string,
	memberSlug: string,
	candidateId: string,
	rating: number,
	ctx: FactoryCtx = {},
) {
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('rating must be 1–5');
	const { factoryDir } = roots(ctx);
	const state = loadState(factoryDir);
	const member = requireMember(state, leagueSlug, memberSlug);
	const c = member.candidates.find((x) => x.id === candidateId);
	if (!c) throw new Error('candidate not found');
	c.rating = rating;
	saveState(state, factoryDir);
	return c;
}

export function setStatus(
	leagueSlug: string,
	memberSlug: string,
	candidateId: string,
	status: 'approved' | 'rejected' | 'candidate',
	ctx: FactoryCtx = {},
) {
	const { factoryDir } = roots(ctx);
	const state = loadState(factoryDir);
	const member = requireMember(state, leagueSlug, memberSlug);
	const c = member.candidates.find((x) => x.id === candidateId);
	if (!c) throw new Error('candidate not found');
	if (status === 'approved') {
		for (const other of member.candidates) {
			if (other.themeSlug === c.themeSlug && other.status === 'approved') other.status = 'candidate';
		}
	}
	c.status = status;
	saveState(state, factoryDir);
	return c;
}

export function pickSourcePhoto(
	leagueSlug: string,
	memberSlug: string,
	sourceRel: string,
	ctx: FactoryCtx = {},
) {
	const { factoryDir, sourcesDir } = roots(ctx);
	const abs = resolveUnderRoot(sourcesDir, sourceRel);
	if (!existsSync(abs) || !isImageName(abs)) throw new PathGuardError('not an image');
	return copyPhoto(factoryDir, leagueSlug, memberSlug, abs, extname(abs));
}

export function uploadPhoto(
	leagueSlug: string,
	memberSlug: string,
	bytes: Uint8Array,
	filename: string,
	ctx: FactoryCtx = {},
) {
	if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('photo too large (5MB)');
	if (!isImageName(filename)) throw new Error('not an image');
	const { factoryDir } = roots(ctx);
	const tmp = join(photosRoot(factoryDir), '_upload', `${newId()}${extname(filename)}`);
	mkdirSync(dirname(tmp), { recursive: true });
	writeFileSync(tmp, bytes);
	return copyPhoto(factoryDir, leagueSlug, memberSlug, tmp, extname(filename));
}

function copyPhoto(factoryDir: string, leagueSlug: string, memberSlug: string, src: string, ext: string) {
	assertSlug(leagueSlug, 'league');
	assertSlug(memberSlug, 'member');
	const state = loadState(factoryDir);
	const league = ensureLeague(state, leagueSlug, leagueSlug);
	const member = requireMember(state, leagueSlug, memberSlug);
	const destRel = `${leagueSlug}/${memberSlug}/${Date.now()}${ext.toLowerCase()}`;
	const destAbs = join(photosRoot(factoryDir), destRel);
	if (existsSync(destAbs)) throw new Error('refusing overwrite');
	mkdirSync(dirname(destAbs), { recursive: true });
	copyFileSync(src, destAbs);
	member.photoRel = destRel;
	saveState(state, factoryDir);
	return member;
}

export function createTheme(
	input: { slug: string; name: string; prompt: string; attachInspiration?: boolean },
	ctx: FactoryCtx = {},
) {
	const slug = slugify(input.slug || input.name);
	const { factoryDir } = roots(ctx);
	const state = loadState(factoryDir);
	if (state.themes.some((t) => t.slug === slug)) throw new Error('theme exists');
	const theme: ThemeRecord = {
		slug,
		name: input.name || slug,
		prompt: input.prompt,
		attachInspiration: input.attachInspiration !== false,
		inspirationRels: [],
		source: 'in-app',
	};
	state.themes.push(theme);
	saveState(state, factoryDir);
	return theme;
}

function requireMember(state: FactoryState, leagueSlug: string, memberSlug: string) {
	const league = state.leagues[leagueSlug];
	if (!league) throw new Error('league not loaded — rescan sources');
	const member = findMember(league, memberSlug);
	if (!member) throw new Error('member not found');
	return member;
}

function requireTheme(state: FactoryState, themeSlug: string): ThemeRecord {
	const t = state.themes.find((x) => x.slug === themeSlug);
	if (!t) throw new Error('theme not found');
	return t;
}

export async function generateOptions(
	input: {
		leagueSlug: string;
		themeSlug: string;
		memberSlug: string;
		count?: number;
		tweakNote?: string;
		baseCandidateId?: string;
		provider?: string;
	},
	ctx: FactoryCtx = {},
) {
	assertGenerationAllowed();
	const provider = resolveProvider(input.provider);
	const { factoryDir, sourcesDir, img } = roots(ctx);
	const state = loadState(factoryDir);
	const member = requireMember(state, input.leagueSlug, input.memberSlug);
	const theme = requireTheme(state, input.themeSlug);
	const letters = optionLetters(clampOptionCount(input.count ?? 3));
	if (!member.photoRel) throw new Error('member has no source photo');
	const photoAbs = join(photosRoot(factoryDir), member.photoRel);
	if (!existsSync(photoAbs)) throw new Error('source photo missing on disk');

	const notesMd = readNotesMd(sourcesDir, member.slug);
	const prompt = assembleAvatarPrompt({
		stylePrompt: theme.prompt,
		globalNotes: GLOBAL_NOTES,
		memberSlug: member.slug,
		memberName: member.name,
		memberNotes: member.notes,
		notesMd,
		height: member.height,
		tweakNote: input.tweakNote,
	});

	const imageDataUrls = [dataUrlFromFile(photoAbs)];
	if (theme.attachInspiration) {
		for (const abs of readInspirationAbs(sourcesDir, theme.inspirationRels).slice(0, 4)) {
			imageDataUrls.push(dataUrlFromFile(abs));
		}
	}

	const created: CandidateRecord[] = [];
	for (const letter of letters) {
		const result = await generateOpenRouterImage({
			prompt,
			imageDataUrls,
			model: provider.defaultModel,
			fetchImpl: ctx.fetchImpl,
		});
		const allocated = allocateVersionedPath(img, input.leagueSlug, input.themeSlug, input.memberSlug, letter);
		writeFileSync(allocated.abs, result.bytes);
		const costUsd = result.costEstimated ? provider.estimatedCostUsd : result.costUsd;
		const rec: CandidateRecord = {
			id: newId(),
			themeSlug: input.themeSlug,
			letter,
			relPath: allocated.rel,
			label: input.tweakNote ? `tweak ${letter}` : `option ${letter}`,
			rating: null,
			status: 'candidate',
			source: 'generated',
			prompt,
			tweakNote: input.tweakNote,
			createdAt: new Date().toISOString(),
			costUsd,
			costEstimated: result.costEstimated,
			provider: provider.id,
			model: provider.defaultModel,
		};
		member.candidates.push(rec);
		created.push(rec);
		state.costUsd += costUsd;
		state.attemptCount += 1;
	}
	saveState(state, factoryDir);
	return { created, prompt, costUsd: state.costUsd, attemptCount: state.attemptCount };
}

export async function requestGroupShot(
	input: { leagueSlug: string; themeSlug: string; provider?: string },
	ctx: FactoryCtx = {},
) {
	assertGenerationAllowed();
	const provider = resolveProvider(input.provider);
	const { factoryDir, img } = roots(ctx);
	const state = loadState(factoryDir);
	const league = state.leagues[input.leagueSlug];
	if (!league) throw new Error('league not loaded');
	const theme = requireTheme(state, input.themeSlug);
	const approvals = league.members.map((m) => ({
		slug: m.slug,
		approvedCandidateId: approvedForTheme(m, input.themeSlug)?.id ?? null,
	}));
	if (!canRequestGroupShot(approvals)) {
		throw new Error('group shot locked until every member has an approved avatar');
	}

	const prompt = assembleGroupShotPrompt({
		stylePrompt: theme.prompt,
		themeName: theme.name,
		members: league.members.map((m) => ({
			slug: m.slug,
			name: m.name,
			height: m.height,
			notes: m.notes,
		})),
		globalNotes: GLOBAL_NOTES,
	});

	const imageDataUrls: string[] = [];
	for (const m of league.members) {
		const ap = approvedForTheme(m, input.themeSlug);
		if (!ap) continue;
		const abs = join(img, ap.relPath);
		if (existsSync(abs)) imageDataUrls.push(dataUrlFromFile(abs));
	}

	const result = await generateOpenRouterImage({
		prompt,
		imageDataUrls,
		model: provider.defaultModel,
		aspectRatio: '16:9',
		fetchImpl: ctx.fetchImpl,
	});
	const allocated = allocateVersionedPath(img, input.leagueSlug, input.themeSlug, 'group', 'G');
	writeFileSync(allocated.abs, result.bytes);
	const costUsd = result.costEstimated ? provider.estimatedCostUsd : result.costUsd;
	const rec = {
		id: newId(),
		themeSlug: input.themeSlug,
		relPath: allocated.rel,
		label: `group shot ${theme.name}`,
		status: 'candidate' as const,
		source: 'generated' as const,
		createdAt: new Date().toISOString(),
		costUsd,
		costEstimated: result.costEstimated,
		provider: provider.id,
		model: provider.defaultModel,
		prompt,
	};
	league.groupShots.push(rec);
	state.costUsd += costUsd;
	state.attemptCount += 1;
	saveState(state, factoryDir);
	return rec;
}

export function mediaAbs(kind: 'images' | 'photos', rel: string, ctx: FactoryCtx = {}): string {
	const { factoryDir } = roots(ctx);
	const root = kind === 'images' ? imagesRoot(factoryDir) : photosRoot(factoryDir);
	return resolveUnderRoot(root, rel);
}
