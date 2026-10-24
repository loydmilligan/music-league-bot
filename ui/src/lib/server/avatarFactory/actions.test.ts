import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { generateOptions, requestGroupShot, setStatus } from './actions.js';
import { canRequestGroupShot } from './gating.js';
import { approvedForTheme, emptyState, ensureLeague, imagesRoot, photosRoot, saveState } from './store.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

function mockFetch() {
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

describe('generate + group-shot actions', () => {
	it('paused generate, tweak, and group-shot make no outbound fetch', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-pause-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-pause-src-'));
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
		const fetchImpl = mockFetch();
		const prev = process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
		delete process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
		try {
			await expect(
				generateOptions(
					{ leagueSlug: 'boarz-ii-men', themeSlug: 'south-park', memberSlug: 'matt-mariani', count: 1 },
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
					},
					{ factoryDir, sourcesDir, fetchImpl },
				),
			).rejects.toThrow('OpenRouter image gen paused');
			await expect(
				requestGroupShot({ leagueSlug: 'boarz-ii-men', themeSlug: 'south-park' }, { factoryDir, sourcesDir, fetchImpl }),
			).rejects.toThrow('OpenRouter image gen paused');
			expect(fetchImpl).not.toHaveBeenCalled();
		} finally {
			if (prev === undefined) delete process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
			else process.env.AVATAR_FACTORY_OPENROUTER_PAUSED = prev;
		}
	});

	it('writes versioned options and gates the group shot until all approved', async () => {
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
				candidates: [],
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

		const fetchImpl = mockFetch();
		const prev = process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
		process.env.AVATAR_FACTORY_OPENROUTER_PAUSED = '0';
		try {
		const out = await generateOptions(
			{ leagueSlug: 'boarz-ii-men', themeSlug: 'south-park', memberSlug: 'matt-mariani', count: 3 },
			{ factoryDir, sourcesDir, fetchImpl },
		);
		expect(out.created).toHaveLength(3);
		expect(out.created.map((c) => c.letter)).toEqual(['A', 'B', 'C']);
		expect(out.prompt).toContain('glasses');
		expect(out.prompt).toMatch(/height class tall/i);
		expect(fetchImpl).toHaveBeenCalledTimes(3);

		await expect(
			requestGroupShot({ leagueSlug: 'boarz-ii-men', themeSlug: 'south-park' }, { factoryDir, sourcesDir, fetchImpl }),
		).rejects.toThrow(/group shot locked/);

		setStatus('boarz-ii-men', 'matt-mariani', out.created[0].id, 'approved', { factoryDir });
		const after = (await import('./store.js')).loadState(factoryDir);
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

		expect(out.created[0].relPath).toMatch(
			/^boarz-ii-men\/south-park\/matt-mariani\/\d{8}-\d{6}-A\.png$/,
		);
		expect(existsSync(join(imagesRoot(factoryDir), out.created[0].relPath))).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.AVATAR_FACTORY_OPENROUTER_PAUSED;
			else process.env.AVATAR_FACTORY_OPENROUTER_PAUSED = prev;
		}
	});
});
