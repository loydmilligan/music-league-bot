import type { FactoryCtx } from './actions.js';
import { generateOptions, requestGroupShot, setStatus } from './actions.js';
import { factoryRoot, sourcesRoot } from './paths.js';
import { approvedForTheme, loadState, newId, saveState, type StyleJob } from './store.js';
import { assertGenerationAllowed } from './pause.js';
import {
	buildStyleHilNotification,
	hilCallbackUrls,
	hilConfigFromEnv,
	jobHilGate,
	mintHilToken,
	publishStyleHil,
} from './hil.js';
function nowIso(): string {
	return new Date().toISOString();
}

function roots(ctx: FactoryCtx) {
	return { factoryDir: ctx.factoryDir ?? factoryRoot(), sourcesDir: ctx.sourcesDir ?? sourcesRoot() };
}

function persistJob(factoryDir: string, job: StyleJob): StyleJob {
	const state = loadState(factoryDir);
	state.styleJobs = state.styleJobs ?? [];
	const i = state.styleJobs.findIndex((j) => j.id === job.id);
	job.updatedAt = nowIso();
	if (i >= 0) state.styleJobs[i] = job;
	else state.styleJobs.push(job);
	saveState(state, factoryDir);
	return job;
}

function loadJob(factoryDir: string, jobId: string): StyleJob {
	const job = loadState(factoryDir).styleJobs?.find((j) => j.id === jobId);
	if (!job) throw new Error('style job not found');
	return { ...job, tokens: { ...job.tokens }, usedTokens: [...job.usedTokens], membersDone: [...job.membersDone], skipped: [...job.skipped] };
}

export function findStyleJobByToken(factoryDir: string, token: string): { job: StyleJob; gate: 'members' | 'group' } | null {
	if (!token) return null;
	const jobs = loadState(factoryDir).styleJobs ?? [];
	for (const job of jobs) {
		if (job.usedTokens.includes(token)) continue;
		if (job.tokens.members === token && job.status === 'awaiting-members') return { job, gate: 'members' };
		if (job.tokens.group === token && job.status === 'awaiting-group') return { job, gate: 'group' };
	}
	return null;
}

async function sendGate(job: StyleJob, gate: 'members' | 'group', ctx: FactoryCtx, extra: string): Promise<boolean> {
	const token = gate === 'members' ? job.tokens.members : job.tokens.group;
	if (!token) return false;
	const urls = hilCallbackUrls();
	const cfg = hilConfigFromEnv();
	const n = buildStyleHilNotification({
		title: gate === 'members' ? `Generate ${job.name} avatars?` : `Group shot for ${job.name}?`,
		message: extra,
		click: urls.click,
		approveUrl: urls.approveUrl,
		denyUrl: urls.denyUrl,
		token,
		bearer: cfg.token,
	});
	return publishStyleHil(n, { fetchImpl: ctx.ntfyFetchImpl });
}

function membersWithPhotos(factoryDir: string, leagueSlug: string) {
	const league = loadState(factoryDir).leagues[leagueSlug];
	if (!league) throw new Error('league not loaded — rescan sources');
	return league.members;
}

export async function startImplementStyle(
	input: { leagueSlug: string; themeSlug: string; provider?: string },
	ctx: FactoryCtx = {},
): Promise<{ job: StyleJob; hilSent: boolean }> {
	assertGenerationAllowed();
	hilConfigFromEnv();
	const { factoryDir } = roots(ctx);
	const state = loadState(factoryDir);
	const theme = state.themes.find((t) => t.slug === input.themeSlug);
	if (!theme) throw new Error('theme not found');
	const league = state.leagues[input.leagueSlug];
	if (!league) throw new Error('league not loaded — rescan sources');
	const missing = league.members.filter((m) => !m.photoRel).map((m) => m.slug);
	if (missing.length) throw new Error(`missing photos: ${missing.join(', ')}`);
	if (league.members.length === 0) throw new Error('no members');
	const active = (state.styleJobs ?? []).find(
		(j) =>
			j.leagueSlug === input.leagueSlug &&
			j.themeSlug === input.themeSlug &&
			(j.status === 'awaiting-members' ||
				j.status === 'generating-members' ||
				j.status === 'awaiting-group' ||
				j.status === 'generating-group'),
	);
	if (active) throw new Error('style job already in progress');

	const job: StyleJob = {
		id: newId(),
		leagueSlug: input.leagueSlug,
		themeSlug: input.themeSlug,
		name: theme.name,
		prompt: theme.prompt,
		provider: input.provider,
		status: 'awaiting-members',
		tokens: { members: mintHilToken() },
		usedTokens: [],
		membersDone: [],
		skipped: [],
		createdAt: nowIso(),
		updatedAt: nowIso(),
	};
	persistJob(factoryDir, job);
	const n = league.members.length;
	const hilSent = await sendGate(
		job,
		'members',
		ctx,
		`${n} player portrait${n === 1 ? '' : 's'} for ${theme.name} (${input.leagueSlug}). Approve to generate each person, then a second ping asks before the group shot.`,
	);
	return { job, hilSent };
}

async function generateMembers(job: StyleJob, ctx: FactoryCtx): Promise<StyleJob> {
	const { factoryDir, sourcesDir } = roots(ctx);
	job.status = 'generating-members';
	persistJob(factoryDir, job);
	const members = membersWithPhotos(factoryDir, job.leagueSlug);
	for (const m of members) {
		if (job.membersDone.includes(m.slug) || job.skipped.includes(m.slug)) continue;
		const already = approvedForTheme(m, job.themeSlug);
		if (already) {
			job.skipped.push(m.slug);
			persistJob(factoryDir, job);
			continue;
		}
		const out = await generateOptions(
			{
				leagueSlug: job.leagueSlug,
				themeSlug: job.themeSlug,
				memberSlug: m.slug,
				count: 1,
				provider: job.provider,
				confirmed: true,
			},
			ctx,
		);
		const created = out.created[0];
		if (!created) throw new Error(`no candidate for ${m.slug}`);
		setStatus(job.leagueSlug, m.slug, created.id, 'approved', { factoryDir, sourcesDir });
		job.membersDone.push(m.slug);
		persistJob(factoryDir, job);
	}
	job.tokens.group = mintHilToken();
	job.status = 'awaiting-group';
	persistJob(factoryDir, job);
	const done = job.membersDone.length;
	const skipped = job.skipped.length;
	await sendGate(
		job,
		'group',
		ctx,
		`Individuals ready (${done} generated, ${skipped} already approved). Approve to generate the group image.`,
	);
	return job;
}

async function generateGroup(job: StyleJob, ctx: FactoryCtx): Promise<StyleJob> {
	const { factoryDir } = roots(ctx);
	job.status = 'generating-group';
	persistJob(factoryDir, job);
	const rec = await requestGroupShot(
		{ leagueSlug: job.leagueSlug, themeSlug: job.themeSlug, provider: job.provider, confirmed: true },
		ctx,
	);
	job.groupShotId = rec.id;
	job.status = 'done';
	persistJob(factoryDir, job);
	return job;
}

export async function continueStyleJob(jobId: string, ctx: FactoryCtx = {}): Promise<StyleJob> {
	assertGenerationAllowed();
	const { factoryDir } = roots(ctx);
	try {
		const job = loadJob(factoryDir, jobId);
		if (job.status === 'awaiting-members' || job.status === 'generating-members') {
			return generateMembers(job, ctx);
		}
		if (job.status === 'awaiting-group' || job.status === 'generating-group') {
			return generateGroup(job, ctx);
		}
		return job;
	} catch (e) {
		const failed = loadJob(factoryDir, jobId);
		failed.status = 'failed';
		failed.lastError = e instanceof Error ? e.message : 'error';
		persistJob(factoryDir, failed);
		throw e;
	}
}

export function claimStyleHil(
	token: string,
	decision: 'approve' | 'deny',
	ctx: FactoryCtx = {},
): { ok: boolean; job?: StyleJob; reason?: string; shouldContinue: boolean } {
	const { factoryDir } = roots(ctx);
	const hit = findStyleJobByToken(factoryDir, token);
	if (!hit) return { ok: false, reason: 'invalid or already-used token', shouldContinue: false };
	const job = loadJob(factoryDir, hit.job.id);
	job.usedTokens.push(token);
	if (decision === 'deny') {
		job.status = 'denied';
		persistJob(factoryDir, job);
		return { ok: true, job, shouldContinue: false };
	}
	const gate = jobHilGate(job);
	if (gate !== hit.gate) {
		job.status = 'failed';
		job.lastError = 'hil gate mismatch';
		persistJob(factoryDir, job);
		return { ok: false, job, reason: 'hil gate mismatch', shouldContinue: false };
	}
	persistJob(factoryDir, job);
	return { ok: true, job, shouldContinue: true };
}

export async function resolveStyleHil(
	token: string,
	decision: 'approve' | 'deny',
	ctx: FactoryCtx = {},
): Promise<{ ok: boolean; job?: StyleJob; reason?: string }> {
	const claimed = claimStyleHil(token, decision, ctx);
	if (!claimed.ok || !claimed.job) return { ok: false, reason: claimed.reason, job: claimed.job };
	if (!claimed.shouldContinue) return { ok: true, job: claimed.job };
	try {
		const next = await continueStyleJob(claimed.job.id, ctx);
		return { ok: true, job: next };
	} catch (e) {
		const { factoryDir } = roots(ctx);
		const failed = loadJob(factoryDir, claimed.job.id);
		failed.status = 'failed';
		failed.lastError = e instanceof Error ? e.message : 'error';
		persistJob(factoryDir, failed);
		throw e;
	}
}
