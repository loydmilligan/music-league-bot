import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createTheme, updateTheme } from './actions.js';
import {
	brainstormTheme,
	buildThemePrompt,
	fallbackBuildPrompt,
	parseBrainstormJson,
	parseBrainstormList,
	pickCatalogStyle,
	pickCatalogStyles,
	STYLE_CATALOG,
	suggestThemes,
} from './brainstorm.js';
import { emptyState, ensureLeague, loadState, photosRoot, saveState } from './store.js';

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

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

function seed(factoryDir: string) {
	mkdirSync(join(photosRoot(factoryDir), 'hip-jammers/matt-mariani'), { recursive: true });
	writeFileSync(join(photosRoot(factoryDir), 'hip-jammers/matt-mariani/headshot.png'), PNG);
	const state = emptyState();
	state.themes.push({
		slug: 'south-park',
		name: 'South Park',
		prompt: 'Draw a South Park cutout.',
		attachInspiration: false,
		inspirationRels: [],
		source: 'in-app',
	});
	const league = ensureLeague(state, 'hip-jammers', 'Hip Jammers');
	league.members.push({
		slug: 'matt-mariani',
		name: 'Matt',
		playerId: 1,
		height: 'tall',
		notes: '',
		photoRel: 'hip-jammers/matt-mariani/headshot.png',
		candidates: [],
	});
	saveState(state, factoryDir);
}

describe('brainstormTheme', () => {
	it('parses a JSON draft and uniquifies an existing slug', () => {
		const draft = parseBrainstormJson(
			'```json\n{"slug":"south-park","name":"South Park 2","prompt":"cutout v2","rationale":"fresh"}\n```',
			['south-park'],
		);
		expect(draft?.slug).toBe('south-park-2');
		expect(draft?.name).toBe('South Park 2');
		expect(draft?.source).toBe('llm');
	});

	it('picks an unused catalog lane, preferring an idea match', () => {
		const draft = pickCatalogStyle(['south-park'], 'muppet');
		expect(draft.slug).toBe('muppets');
		expect(draft.source).toBe('catalog');
	});

	it('creates a ready-to-use theme from catalog when no OpenRouter key, without image gen', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-brain-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-brain-src-'));
		seed(factoryDir);
		const ntfyFetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
		const out = await withEnv(
			{ OPENROUTER_API_KEY: undefined, NTFY_URL: 'https://n.example', NTFY_TOKEN: 'k', NTFY_TOPIC: 'mlb-digest' },
			() => brainstormTheme({ idea: 'lego', leagueSlug: 'hip-jammers' }, { factoryDir, sourcesDir, ntfyFetchImpl }),
		);
		expect(out.draft.source).toBe('catalog');
		expect(out.theme.slug).toBe('lego-minifig');
		expect(out.theme.prompt).toMatch(/LEGO/i);
		expect(loadState(factoryDir).themes.some((t) => t.slug === 'lego-minifig')).toBe(true);
		expect(ntfyFetchImpl).toHaveBeenCalledTimes(1);
		const ntfyBody = JSON.parse(String(ntfyFetchImpl.mock.calls[0][1]?.body));
		expect(ntfyBody.topic).toBe('avatar-hil');
	});

	it('uses a text-only OpenRouter completion (no image modalities) when fetch is injected', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-brain-llm-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-brain-llm-src-'));
		seed(factoryDir);
		const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
			expect(String(input)).toContain('openrouter.ai');
			const body = JSON.parse(String(init?.body));
			expect(body.modalities).toBeUndefined();
			expect(body.messages?.[0]?.content).not.toMatch(/data:image/);
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									slug: 'stained-glass',
									name: 'Stained glass',
									prompt: 'Stained-glass portrait of this person. Keep likeness from the reference.',
									rationale: 'Church-window glow for the league.',
								}),
							},
						},
					],
				}),
				{ status: 200 },
			);
		});
		const ntfyFetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
		const out = await withEnv({ OPENROUTER_API_KEY: 'x', NTFY_URL: 'https://n.example', NTFY_TOKEN: 'k' }, () =>
			brainstormTheme({ idea: 'church window', leagueSlug: 'hip-jammers' }, { factoryDir, sourcesDir, fetchImpl, ntfyFetchImpl }),
		);
		expect(out.theme.slug).toBe('stained-glass');
		expect(out.draft.source).toBe('llm');
		expect(out.theme.prompt).toMatch(/Stained-glass/);
		expect(STYLE_CATALOG.some((c) => c.slug === 'stained-glass')).toBe(false);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});

describe('theme suggester + prompt builder', () => {
	it('parses a styles list and uniquifies slugs inside the batch', () => {
		const drafts = parseBrainstormList(
			JSON.stringify({
				styles: [
					{ slug: 'south-park', name: 'SP2', prompt: 'cutout a', rationale: 'a' },
					{ slug: 'south-park', name: 'SP3', prompt: 'cutout b', rationale: 'b' },
				],
			}),
			['south-park'],
		);
		expect(drafts.map((d) => d.slug)).toEqual(['south-park-2', 'south-park-3']);
		expect(drafts[0].source).toBe('llm');
	});

	it('picks several unused catalog lanes without creating themes', () => {
		const drafts = pickCatalogStyles(['south-park'], 'muppet', 3);
		expect(drafts).toHaveLength(3);
		expect(drafts[0].slug).toBe('muppets');
		expect(new Set(drafts.map((d) => d.slug)).size).toBe(3);
	});

	it('suggestThemes returns catalog drafts and does not write a theme', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-sug-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-sug-src-'));
		seed(factoryDir);
		const before = loadState(factoryDir).themes.length;
		const out = await withEnv({ OPENROUTER_API_KEY: undefined }, () =>
			suggestThemes({ idea: 'lego', leagueSlug: 'hip-jammers', count: 3 }, { factoryDir, sourcesDir }),
		);
		expect(out.drafts).toHaveLength(3);
		expect(out.drafts[0].slug).toBe('lego-minifig');
		expect(loadState(factoryDir).themes).toHaveLength(before);
	});

	it('suggestThemes uses a text-only OpenRouter completion (no image modalities)', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-sug-llm-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-sug-llm-src-'));
		seed(factoryDir);
		const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
			expect(String(input)).toContain('openrouter.ai');
			const body = JSON.parse(String(init?.body));
			expect(body.modalities).toBeUndefined();
			expect(body.messages?.[0]?.content).not.toMatch(/data:image/);
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									styles: [
										{
											slug: 'diner-neon',
											name: 'Diner neon',
											prompt: 'Neon diner portrait of this person. Keep likeness from the reference.',
											rationale: 'Bakersfield night.',
										},
										{
											slug: 'yearbook-78',
											name: '1978 yearbook',
											prompt: 'Soft yearbook portrait of this person. Keep likeness from the reference.',
											rationale: 'School-photo grain.',
										},
									],
								}),
							},
						},
					],
				}),
				{ status: 200 },
			);
		});
		const out = await withEnv({ OPENROUTER_API_KEY: 'x' }, () =>
			suggestThemes({ idea: 'bakersfield', leagueSlug: 'hip-jammers', count: 2 }, { factoryDir, sourcesDir, fetchImpl }),
		);
		expect(out.drafts).toHaveLength(2);
		expect(out.drafts[0].slug).toBe('diner-neon');
		expect(out.drafts[0].source).toBe('llm');
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(loadState(factoryDir).themes.some((t) => t.slug === 'diner-neon')).toBe(false);
	});

	it('fallbackBuildPrompt adds a likeness lock when the draft prompt omitted it', () => {
		const draft = fallbackBuildPrompt({ name: 'Felt puppet', idea: 'muppets', prompt: 'Felt and foam portrait.' });
		expect(draft.prompt).toMatch(/likeness/i);
		expect(draft.name).toBe('Felt puppet');
	});

	it('buildThemePrompt falls back without a key and does not create a theme', async () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-build-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-build-src-'));
		seed(factoryDir);
		const before = loadState(factoryDir).themes.length;
		const out = await withEnv({ OPENROUTER_API_KEY: undefined }, () =>
			buildThemePrompt(
				{ name: 'Stained glass', idea: 'church window', notes: 'no gothic horror' },
				{ factoryDir, sourcesDir },
			),
		);
		expect(out.draft.name).toBe('Stained glass');
		expect(out.draft.prompt).toMatch(/likeness/i);
		expect(out.draft.prompt).toMatch(/church window/i);
		expect(loadState(factoryDir).themes).toHaveLength(before);
	});

	it('updateTheme rewrites the prompt of an existing style', () => {
		const factoryDir = mkdtempSync(join(tmpdir(), 'af-upd-'));
		const sourcesDir = mkdtempSync(join(tmpdir(), 'af-upd-src-'));
		seed(factoryDir);
		createTheme({ slug: 'clay-bake', name: 'Clay bake', prompt: 'old' }, { factoryDir, sourcesDir });
		const updated = updateTheme('clay-bake', { prompt: 'new clay prompt' }, { factoryDir, sourcesDir });
		expect(updated.prompt).toBe('new clay prompt');
		expect(loadState(factoryDir).themes.find((t) => t.slug === 'clay-bake')?.prompt).toBe('new clay prompt');
	});
});
