import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { generateOptions, requestGroupShot, setRating, setStatus } from './actions.js';
import { canRequestGroupShot } from './gating.js';
import { CONFIRM_REQUIRED } from './pause.js';
import { approvedForTheme, emptyState, ensureLeague, imagesRoot, loadState, photosRoot, saveState } from './store.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

function mockFetch(opts: { cost?: number } = { cost: 0.01 }) {
	return vi.fn(async () => {
		const usage = opts.cost === undefined ? { prompt_tokens: 1 } : { cost: opts.cost };
		return new Response(
			JSON.stringify({
				choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } }] } }],
				usage,
			}),
			{ status: 200 },
		);
	});
}

function seedMatt(factoryDir: string) {
	mkdirSync(join(photosRoot(factoryDir), 'boarz-ii-men/matt-mariani'), { recursive: true });
	writeFileSync(join(photosRoot(factoryDir), 'boarz-ii-men/matt-mariani/headshot.png'), PNG);
	const state = emptyState();
	state.themes.push({
		slug: 'south-park',
		name: 'South Park',
		prompt: 'Draw a South Park cutout.',
		attachInspiration: false,
		inspirationRels: [],
		source: 'in-app',
	});
	const league = ensureLeague(state, 'boarz-ii-men', 'Boarz II Men');
	league.members.push({
		slug: 'matt-mariani',
		name: 'Matt',
		playerId: 1,
		height: 'tall',
		notes: 'glasses',
		photoRel: 'boarz-ii-men/matt-mariani/headshot.png',
		candidates: [],
	});
	saveState(state, factoryDir);
	return state;
}

describe('generate + group-shot actions', () => {
	it('unconfirmed generate and group-shot make no outbound fetch', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-noconfirm-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-noconfirm-src-'));
		seedMatt(factoryDir);
		const fetchImpl = mockFetch();
		await expect(
			generateOptions(
				{ leagueSlug: 'boarz-ii-men', themeSlug: 'south-park', memberSlug: 'matt-mariani', count: 1 },
				{ factoryDir, sourcesDir, fetchImpl },
			),
		).rejects.toThrow(CONFIRM_REQUIRED);
		await expect(
			requestGroupShot({ leagueSlug: 'boarz-ii-men', themeSlug: 'south-park' }, { factoryDir, sourcesDir, fetchImpl }),
		).rejects.toThrow(CONFIRM_REQUIRED);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('paused generate, tweak, and group-shot make no outbound fetch', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-pause-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-pause-src-'));
		seedMatt(factoryDir);
		const fetchImpl = mockFetch();
		const prev = process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
		process.env.AVATAR_FACTORY_OPENROUTER_PAUSED = '1';
		try {
			await expect(
				generateOptions(
					{
						leagueSlug: 'boarz-ii-men',
						themeSlug: 'south-park',
						memberSlug: 'matt-mariani',
						count: 1,
						confirmed: true,
					},
					{ factoryDir, sourcesDir, fetchImpl },
				),
			).rejects.toThrow('OpenRouter image gen paused');
			await expect(
				generateOptions(
					{
						leagueSlug: 'boarz-ii-men',
						themeSlug: 'south-park',
						memberSlug: 'matt-mariani',
						count: 1,
						tweakNote: 'more hair',
						confirmed: true,
					},
					{ factoryDir, sourcesDir, fetchImpl },
				),
			).rejects.toThrow('OpenRouter image gen paused');
			await expect(
				requestGroupShot(
					{ leagueSlug: 'boarz-ii-men', themeSlug: 'south-park', confirmed: true },
					{ factoryDir, sourcesDir, fetchImpl },
				),
			).rejects.toThrow('OpenRouter image gen paused');
			expect(fetchImpl).not.toHaveBeenCalled();
		} finally {
			if (prev === undefined) delete process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
			else process.env.AVATAR_FACTORY_OPENROUTER_PAUSED = prev;
		}
	});

	it('writes versioned options, records cost, and feeds rated comments into the prompt', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-act-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-src-'));
		mkdirSync(join(photosRoot(factoryDir), 'boarz-ii-men/matt-mariani'), { recursive: true });
		writeFileSync(join(photosRoot(factoryDir), 'boarz-ii-men/matt-mariani/headshot.png'), PNG);

		const state = emptyState();
		state.themes.push({
			slug: 'south-park',
			name: 'South Park',
			prompt: 'Draw a South Park cutout.',
			attachInspiration: false,
			inspirationRels: [],
			source: 'in-app',
		});
		const league = ensureLeague(state, 'boarz-ii-men', 'Boarz II Men');
		league.members.push(
			{
				slug: 'matt-mariani',
				name: 'Matt',
				playerId: 1,
				height: 'tall',
				notes: 'glasses',
				photoRel: 'boarz-ii-men/matt-mariani/headshot.png',
				candidates: [
					{
						id: 'seed-a',
						themeSlug: 'south-park',
						letter: 'Z',
						relPath: 'imported.png',
						label: 'imported',
						rating: 5,
						ratingComment: 'great hair',
						status: 'candidate',
						source: 'imported',
						createdAt: '2026-01-01T00:00:00.000Z',
					},
					{
						id: 'seed-b',
						themeSlug: 'south-park',
						letter: 'Y',
						relPath: 'imported-b.png',
						label: 'imported b',
						rating: 1,
						ratingComment: 'too bald',
						status: 'candidate',
						source: 'imported',
						createdAt: '2026-01-01T00:00:01.000Z',
					},
				],
			},
			{
				slug: 'jon-black',
				name: 'Jon',
				playerId: 4,
				height: 'medium',
				notes: 'long hair',
				photoRel: null,
				candidates: [],
			},
		);
		saveState(state, factoryDir);

		const fetchImpl = mockFetch({ cost: 0.01 });
		const out = await generateOptions(
			{
				leagueSlug: 'boarz-ii-men',
				themeSlug: 'south-park',
				memberSlug: 'matt-mariani',
				count: 3,
				confirmed: true,
			},
			{ factoryDir, sourcesDir, fetchImpl },
		);
		expect(out.created).toHaveLength(3);
		expect(out.created.map((c) => c.letter)).toEqual(['A', 'B', 'C']);
		expect(out.created[0].provider).toBe('openrouter');
		expect(out.created[0].model).toBe('google/gemini-2.5-flash-image');
		expect(out.created[0].costUsd).toBe(0.01);
		expect(out.created[0].costEstimated).toBe(false);
		expect(out.created[0].usedNotes).toContain('great hair');
		expect(out.created[0].usedNotes).toContain('too bald');
		expect(out.prompt).toContain('glasses');
		expect(out.prompt).toContain('great hair');
		expect(out.prompt).toContain('too bald');
		expect(out.prompt).toMatch(/height class tall/i);
		expect(fetchImpl).toHaveBeenCalledTimes(3);

		await expect(
			requestGroupShot(
				{ leagueSlug: 'boarz-ii-men', themeSlug: 'south-park', confirmed: true },
				{ factoryDir, sourcesDir, fetchImpl },
			),
		).rejects.toThrow(/group shot locked/);

		setStatus('boarz-ii-men', 'matt-mariani', out.created[0].id, 'approved', { factoryDir });
		const after = loadState(factoryDir);
		const matt = after.leagues['boarz-ii-men'].members.find((m) => m.slug === 'matt-mariani')!;
		expect(approvedForTheme(matt, 'south-park')?.id).toBe(out.created[0].id);
		expect(
			canRequestGroupShot(
				after.leagues['boarz-ii-men'].members.map((m) => ({
					slug: m.slug,
					approvedCandidateId: approvedForTheme(m, 'south-park')?.id ?? null,
				})),
			),
		).toBe(false);

		expect(out.created[0].relPath).toMatch(/^boarz-ii-men\/south-park\/matt-mariani\/\d{8}-\d{6}-A\.png$/);
		expect(existsSync(join(imagesRoot(factoryDir), out.created[0].relPath))).toBe(true);

		const rated = setRating('boarz-ii-men', 'matt-mariani', out.created[1].id, 4, { factoryDir }, 'keep the glasses');
		expect(rated.rating).toBe(4);
		expect(rated.ratingComment).toBe('keep the glasses');
	});

	it('labels estimate when usage.cost is missing', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-est-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-est-src-'));
		seedMatt(factoryDir);
		const fetchImpl = mockFetch({ cost: undefined });
		const out = await generateOptions(
			{
				leagueSlug: 'boarz-ii-men',
				themeSlug: 'south-park',
				memberSlug: 'matt-mariani',
				count: 1,
				confirmed: true,
			},
			{ factoryDir, sourcesDir, fetchImpl },
		);
		expect(out.created[0].costEstimated).toBe(true);
		expect(out.created[0].costUsd).toBe(0.04);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
