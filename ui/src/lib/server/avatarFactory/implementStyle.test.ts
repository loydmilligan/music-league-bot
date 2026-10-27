import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { continueStyleJob, findStyleJobByToken, resolveStyleHil, startImplementStyle } from './implementStyle.js';
import { approvedForTheme, emptyState, ensureLeague, loadState, photosRoot, saveState } from './store.js';
import { CONFIRM_REQUIRED } from './pause.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

function mockImageFetch() {
	return vi.fn(async () => {
		return new Response(
			JSON.stringify({
				choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } }] } }],
				usage: { cost: 0.01 },
			}),
			{ status: 200 },
		);
	});
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
	const prev: Record<string, string | undefined> = {};
	for (const [k, v] of Object.entries(vars)) {
		prev[k] = process.env[k];
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	try {
		return await fn();
	} finally {
		for (const [k, v] of Object.entries(prev)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	}
}

function seedTwo(factoryDir: string) {
	mkdirSync(join(photosRoot(factoryDir), 'hip-jammers/matt-mariani'), { recursive: true });
	mkdirSync(join(photosRoot(factoryDir), 'hip-jammers/drew-mariani'), { recursive: true });
	writeFileSync(join(photosRoot(factoryDir), 'hip-jammers/matt-mariani/headshot.png'), PNG);
	writeFileSync(join(photosRoot(factoryDir), 'hip-jammers/drew-mariani/headshot.png'), PNG);
	const state = emptyState();
	state.themes.push({
		slug: 'lego-minifig',
		name: 'LEGO minifig',
		prompt: 'LEGO portrait.',
		attachInspiration: false,
		inspirationRels: [],
		source: 'in-app',
	});
	const league = ensureLeague(state, 'hip-jammers', 'Hip Jammers');
	league.members.push(
		{
			slug: 'matt-mariani',
			name: 'Matt',
			playerId: 1,
			height: 'tall',
			notes: '',
			photoRel: 'hip-jammers/matt-mariani/headshot.png',
			candidates: [],
		},
		{
			slug: 'drew-mariani',
			name: 'Drew',
			playerId: 19,
			height: 'medium',
			notes: '',
			photoRel: 'hip-jammers/drew-mariani/headshot.png',
			candidates: [],
		},
	);
	saveState(state, factoryDir);
}

const HIL_ENV = {
	OPENROUTER_API_KEY: 'x',
	NTFY_URL: 'https://n.example',
	NTFY_TOKEN: 'k',
	NTFY_TOPIC: 'mlb-digest',
};

describe('implementStyle', () => {
	it('start sends the members HIL and makes no image fetch', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-impl-start-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-impl-start-src-'));
		seedTwo(factoryDir);
		const fetchImpl = mockImageFetch();
		const ntfyFetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
		const out = await withEnv(HIL_ENV, () =>
			startImplementStyle(
				{ leagueSlug: 'hip-jammers', themeSlug: 'lego-minifig' },
				{ factoryDir, sourcesDir, fetchImpl, ntfyFetchImpl },
			),
		);
		expect(out.job.status).toBe('awaiting-members');
		expect(out.hilSent).toBe(true);
		expect(fetchImpl).not.toHaveBeenCalled();
		const body = JSON.parse(String(ntfyFetchImpl.mock.calls[0][1]?.body));
		expect(body.topic).toBe('avatar-hil');
		expect(body.title).toMatch(/Generate LEGO/i);
		expect(body.actions).toHaveLength(3);
	});

	it('refuses to start when a member has no photo', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-impl-nophoto-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-impl-nophoto-src-'));
		seedTwo(factoryDir);
		const state = loadState(factoryDir);
		state.leagues['hip-jammers'].members[1].photoRel = null;
		saveState(state, factoryDir);
		await withEnv(HIL_ENV, async () => {
			await expect(
				startImplementStyle(
					{ leagueSlug: 'hip-jammers', themeSlug: 'lego-minifig' },
					{ factoryDir, sourcesDir, ntfyFetchImpl: vi.fn(async () => new Response('{}', { status: 200 })) },
				),
			).rejects.toThrow(/missing photos: drew-mariani/);
		});
	});

	it('members HIL generates each person, auto-approves, then pings before the group shot', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-impl-mem-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-impl-mem-src-'));
		seedTwo(factoryDir);
		const fetchImpl = mockImageFetch();
		const ntfyFetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
		const ctx = { factoryDir, sourcesDir, fetchImpl, ntfyFetchImpl };
		const started = await withEnv(HIL_ENV, () =>
			startImplementStyle({ leagueSlug: 'hip-jammers', themeSlug: 'lego-minifig' }, ctx),
		);
		const token = started.job.tokens.members!;
		const resolved = await withEnv(HIL_ENV, () => resolveStyleHil(token, 'approve', ctx));
		expect(resolved.ok).toBe(true);
		expect(resolved.job?.status).toBe('awaiting-group');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const after = loadState(factoryDir);
		const league = after.leagues['hip-jammers'];
		expect(approvedForTheme(league.members[0], 'lego-minifig')).toBeTruthy();
		expect(approvedForTheme(league.members[1], 'lego-minifig')).toBeTruthy();
		expect(league.groupShots).toHaveLength(0);
		expect(ntfyFetchImpl).toHaveBeenCalledTimes(2);
		const groupNtfy = JSON.parse(String(ntfyFetchImpl.mock.calls[1][1]?.body));
		expect(groupNtfy.title).toMatch(/Group shot/i);
		expect(findStyleJobByToken(factoryDir, token)).toBeNull();
		expect(findStyleJobByToken(factoryDir, resolved.job!.tokens.group!)).toBeTruthy();
	});

	it('group HIL generates the group image and finishes', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-impl-grp-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-impl-grp-src-'));
		seedTwo(factoryDir);
		const fetchImpl = mockImageFetch();
		const ntfyFetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
		const ctx = { factoryDir, sourcesDir, fetchImpl, ntfyFetchImpl };
		const started = await withEnv(HIL_ENV, () =>
			startImplementStyle({ leagueSlug: 'hip-jammers', themeSlug: 'lego-minifig' }, ctx),
		);
		await withEnv(HIL_ENV, () => resolveStyleHil(started.job.tokens.members!, 'approve', ctx));
		const job = loadState(factoryDir).styleJobs[0];
		const resolved = await withEnv(HIL_ENV, () => resolveStyleHil(job.tokens.group!, 'approve', ctx));
		expect(resolved.job?.status).toBe('done');
		expect(resolved.job?.groupShotId).toBeTruthy();
		expect(loadState(factoryDir).leagues['hip-jammers'].groupShots).toHaveLength(1);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
	});

	it('deny at the members gate never generates', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-impl-deny-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-impl-deny-src-'));
		seedTwo(factoryDir);
		const fetchImpl = mockImageFetch();
		const ntfyFetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
		const ctx = { factoryDir, sourcesDir, fetchImpl, ntfyFetchImpl };
		const started = await withEnv(HIL_ENV, () =>
			startImplementStyle({ leagueSlug: 'hip-jammers', themeSlug: 'lego-minifig' }, ctx),
		);
		const resolved = await withEnv(HIL_ENV, () => resolveStyleHil(started.job.tokens.members!, 'deny', ctx));
		expect(resolved.job?.status).toBe('denied');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('paused implement start makes no fetch', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-impl-pause-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-impl-pause-src-'));
		seedTwo(factoryDir);
		const fetchImpl = mockImageFetch();
		await withEnv({ ...HIL_ENV, AVATAR_FACTORY_OPENROUTER_PAUSED: '1' }, async () => {
			await expect(
				startImplementStyle(
					{ leagueSlug: 'hip-jammers', themeSlug: 'lego-minifig' },
					{ factoryDir, sourcesDir, fetchImpl, ntfyFetchImpl: vi.fn(async () => new Response('{}', { status: 200 })) },
				),
			).rejects.toThrow('OpenRouter image gen paused');
			expect(fetchImpl).not.toHaveBeenCalled();
		});
	});

	it('continueStyleJob does not run generate without the existing confirm path (uses confirmed internally)', async () => {
		expect(CONFIRM_REQUIRED).toBe('confirm required');
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-impl-cont-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-impl-cont-src-'));
		seedTwo(factoryDir);
		const fetchImpl = mockImageFetch();
		const ntfyFetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
		const ctx = { factoryDir, sourcesDir, fetchImpl, ntfyFetchImpl };
		const started = await withEnv(HIL_ENV, () =>
			startImplementStyle({ leagueSlug: 'hip-jammers', themeSlug: 'lego-minifig' }, ctx),
		);
		await withEnv(HIL_ENV, () => continueStyleJob(started.job.id, ctx));
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
