import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { allocateVersionedNamedPath, allocateVersionedPath, assertSlug, slugify } from './filenames.js';
import { canRequestGroupShot, clampOptionCount, optionLetters, orderMembersByHeight } from './gating.js';
import { GLOBAL_NOTES } from './notes.js';
import {
	isAbortError,
	logProviderError,
	ProviderError,
	reasonFromHttpStatus,
	type ImageRefMeta,
	type LastError,
} from './errors.js';
import { generateFactoryImage, GROUP_SHOT_TIMEOUT_MS, type FetchLike } from './generate.js';
import { factoryCostTotals } from './cost.js';
import { normalizeImage, type NormalizedImage } from './normalize.js';
import { composeReferenceSheet, type SheetResult } from './sheet.js';
import { assertConfirmed, assertGenerationAllowed, isGenerationPaused, PAUSED_MESSAGE } from './pause.js';
import { DEFAULT_PROVIDER, listProviders, resolveProvider } from './providers.js';
import { factoryRoot, isImageName, PathGuardError, resolveUnderRoot, sourcesRoot } from './paths.js';
import {
	assembleAvatarPrompt,
	assembleGroupShotPrompt,
	assembleRatingNotes,
	RUNWAY_PROMPT_LIMIT,
	truncatePromptKeepNotes,
} from './prompts.js';
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

export interface FactoryCtx {
	factoryDir?: string;
	sourcesDir?: string;
	fetchImpl?: FetchLike;
	normalizeImpl?: (input: Buffer, filename: string) => Promise<NormalizedImage>;
	composeSheetImpl?: (tiles: { input: Buffer; name: string }[]) => Promise<SheetResult>;
	timeoutMs?: number;
	ntfyFetchImpl?: FetchLike;
}

function roots(ctx: FactoryCtx) {
	const factoryDir = ctx.factoryDir ?? factoryRoot();
	const sourcesDir = ctx.sourcesDir ?? sourcesRoot();
	return { factoryDir, sourcesDir, img: imagesRoot(factoryDir) };
}

async function normalizeFile(abs: string, ctx: FactoryCtx): Promise<NormalizedImage> {
	const fn = ctx.normalizeImpl ?? normalizeImage;
	return fn(readFileSync(abs), basename(abs));
}

function asProviderError(
	e: unknown,
	provider: string,
	model: string,
	refs?: ImageRefMeta[],
): ProviderError {
	if (e instanceof ProviderError) return e;
	if (isAbortError(e)) {
		return new ProviderError({
			provider,
			model,
			status: null,
			reason: 'timeout',
			snippet: e instanceof Error ? e.message : 'aborted',
			refs,
		});
	}
	const msg = e instanceof Error ? e.message : 'error';
	const hit = msg.match(/\b(400|401|402|429|500|502|503)\b/);
	const status = hit ? Number(hit[1]) : null;
	return new ProviderError({
		provider,
		model,
		status,
		reason: status != null ? reasonFromHttpStatus(status) : 'provider_http',
		snippet: msg,
		refs,
	});
}

function persistProviderFailure(
	state: FactoryState,
	factoryDir: string,
	pe: ProviderError,
	target: { member?: { lastError?: LastError }; league?: { lastError?: LastError } },
): never {
	logProviderError(pe);
	const last = pe.toLastError();
	if (target.member) target.member.lastError = last;
	if (target.league) target.league.lastError = last;
	if (typeof pe.failedCostUsd === 'number') state.failedCostUsd += pe.failedCostUsd;
	state.attemptCount += 1;
	saveState(state, factoryDir);
	throw pe;
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
		costTotals: factoryCostTotals(fresh, leagueSlug),
		styleJobs: (fresh.styleJobs ?? []).filter((j) => j.leagueSlug === leagueSlug),
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
	comment?: string,
) {
	const hasRating = Number.isInteger(rating) && rating >= 1 && rating <= 5;
	if (!hasRating && comment === undefined) throw new Error('rating must be 1–5');
	const { factoryDir } = roots(ctx);
	const state = loadState(factoryDir);
	const member = requireMember(state, leagueSlug, memberSlug);
	const c = member.candidates.find((x) => x.id === candidateId);
	if (!c) throw new Error('candidate not found');
	if (hasRating) c.rating = rating;
	if (comment !== undefined) c.ratingComment = comment;
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

export function updateTheme(
	slug: string,
	input: { name?: string; prompt?: string },
	ctx: FactoryCtx = {},
) {
	const { factoryDir } = roots(ctx);
	const state = loadState(factoryDir);
	const theme = state.themes.find((x) => x.slug === slug);
	if (!theme) throw new Error('theme not found');
	if (input.name != null) {
		const name = input.name.trim();
		if (name) theme.name = name;
	}
	if (input.prompt != null) theme.prompt = input.prompt;
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

function memberRatingNotes(member: { candidates: CandidateRecord[] }, themeSlug: string): string {
	return assembleRatingNotes(
		member.candidates
			.filter((c) => c.themeSlug === themeSlug && c.rating != null && (c.ratingComment ?? '').trim())
			.map((c) => ({ letter: c.letter, rating: c.rating as number, comment: (c.ratingComment ?? '').trim() })),
	);
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
		confirmed?: boolean;
	},
	ctx: FactoryCtx = {},
) {
	assertConfirmed(input.confirmed);
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
	const ratingNotes = memberRatingNotes(member, input.themeSlug);
	let prompt = assembleAvatarPrompt({
		stylePrompt: theme.prompt,
		globalNotes: GLOBAL_NOTES,
		memberSlug: member.slug,
		memberName: member.name,
		memberNotes: member.notes,
		notesMd,
		height: member.height,
		tweakNote: input.tweakNote,
		ratingNotes,
	});
	let promptTruncated = false;
	if (provider.id === 'runway') {
		const tagLine = 'Use @subject as the person.';
		const fit = truncatePromptKeepNotes(
			prompt,
			[member.notes, notesMd, ratingNotes, input.tweakNote ?? ''],
			RUNWAY_PROMPT_LIMIT - tagLine.length - 1,
		);
		prompt = `${tagLine}\n${fit.text}`;
		promptTruncated = fit.truncated;
	}

	const photo = await normalizeFile(photoAbs, ctx);
	const imageDataUrls = [photo.dataUrl];
	const imageMeta = [photo];
	if (theme.attachInspiration) {
		for (const abs of readInspirationAbs(sourcesDir, theme.inspirationRels).slice(0, 4)) {
			const n = await normalizeFile(abs, ctx);
			imageDataUrls.push(n.dataUrl);
			imageMeta.push(n);
		}
	}

	const created: CandidateRecord[] = [];
	for (const letter of letters) {
		let result;
		try {
			result = await generateFactoryImage(provider, {
				prompt,
				imageDataUrls,
				model: provider.defaultModel,
				fetchImpl: ctx.fetchImpl,
				imageMeta,
			});
		} catch (e) {
			persistProviderFailure(
				state,
				factoryDir,
				asProviderError(e, provider.id, provider.defaultModel, imageMeta),
				{ member },
			);
		}
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
			usedNotes: ratingNotes || undefined,
			createdAt: new Date().toISOString(),
			costUsd,
			costEstimated: result.costEstimated,
			pricingBasis: result.costEstimated ? provider.pricingBasis : undefined,
			promptTruncated: promptTruncated || undefined,
			provider: provider.id,
			model: provider.defaultModel,
		};
		member.candidates.push(rec);
		created.push(rec);
		state.costUsd += costUsd;
		state.attemptCount += 1;
	}
	delete member.lastError;
	saveState(state, factoryDir);
	return { created, prompt, costUsd: state.costUsd, attemptCount: state.attemptCount };
}

export async function requestGroupShot(
	input: { leagueSlug: string; themeSlug: string; provider?: string; confirmed?: boolean },
	ctx: FactoryCtx = {},
) {
	assertConfirmed(input.confirmed);
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

	const ordered = orderMembersByHeight(league.members);
	let prompt = assembleGroupShotPrompt({
		stylePrompt: theme.prompt,
		themeName: theme.name,
		members: ordered.map((m) => ({
			slug: m.slug,
			name: m.name,
			height: m.height,
			notes: m.notes,
		})),
		globalNotes: GLOBAL_NOTES,
	});
	let promptTruncated = false;
	if (provider.id === 'runway') {
		const tagLine = 'Use @subject as the people.';
		const memberNotes = ordered.map((m) => m.notes).filter(Boolean);
		const fit = truncatePromptKeepNotes(prompt, memberNotes, RUNWAY_PROMPT_LIMIT - tagLine.length - 1);
		prompt = `${tagLine}\n${fit.text}`;
		promptTruncated = fit.truncated;
	}

	const tiles: { input: Buffer; name: string }[] = [];
	for (const m of ordered) {
		const ap = approvedForTheme(m, input.themeSlug);
		if (!ap) continue;
		const abs = join(img, ap.relPath);
		if (!existsSync(abs)) continue;
		tiles.push({ input: readFileSync(abs), name: m.name });
	}
	if (tiles.length === 0) throw new Error('approved avatars missing on disk');

	const compose = ctx.composeSheetImpl ?? composeReferenceSheet;
	const sheet = await compose(tiles);
	const sheetPath = allocateVersionedNamedPath(img, input.leagueSlug, input.themeSlug, 'group', 'sheet', 'jpg');
	writeFileSync(sheetPath.abs, sheet.jpeg);
	league.lastSheetRel = sheetPath.rel;

	const imageMeta: ImageRefMeta[] = [
		{
			filename: basename(sheetPath.rel),
			width: sheet.width,
			height: sheet.height,
			bytes: sheet.jpeg.byteLength,
		},
	];
	const imageDataUrls = [`data:image/jpeg;base64,${sheet.jpeg.toString('base64')}`];

	let result;
	try {
		result = await generateFactoryImage(provider, {
			prompt,
			imageDataUrls,
			model: provider.defaultModel,
			aspectRatio: '16:9',
			fetchImpl: ctx.fetchImpl,
			imageMeta,
			timeoutMs: ctx.timeoutMs ?? GROUP_SHOT_TIMEOUT_MS,
		});
	} catch (e) {
		persistProviderFailure(
			state,
			factoryDir,
			asProviderError(e, provider.id, provider.defaultModel, imageMeta),
			{ league },
		);
	}
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
		pricingBasis: result.costEstimated ? provider.pricingBasis : undefined,
		promptTruncated: promptTruncated || undefined,
		provider: provider.id,
		model: provider.defaultModel,
		prompt,
		sheetRel: sheetPath.rel,
	};
	league.groupShots.push(rec);
	state.costUsd += costUsd;
	state.attemptCount += 1;
	delete league.lastError;
	saveState(state, factoryDir);
	return rec;
}

export function mediaAbs(kind: 'images' | 'photos', rel: string, ctx: FactoryCtx = {}): string {
	const { factoryDir } = roots(ctx);
	const root = kind === 'images' ? imagesRoot(factoryDir) : photosRoot(factoryDir);
	return resolveUnderRoot(root, rel);
}
