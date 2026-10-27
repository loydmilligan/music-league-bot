import { appBaseUrl } from '$lib/config/urls.js';
import type { FactoryCtx } from './actions.js';
import { createTheme, publicState } from './actions.js';
import { slugify } from './filenames.js';
import type { FetchLike } from './generate.js';
import type { Notification } from '$lib/digest/ntfy.js';
import { hilCallbackUrls, publishStyleHil } from './hil.js';
import { factoryRoot, sourcesRoot } from './paths.js';
import { loadState, type ThemeRecord } from './store.js';

export const BRAINSTORM_MODEL = 'google/gemini-2.5-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface StyleDraft {
	slug: string;
	name: string;
	prompt: string;
	rationale: string;
	source: 'llm' | 'catalog';
}

export interface CatalogStyle {
	slug: string;
	name: string;
	prompt: string;
	rationale: string;
}

/** Unused visual lanes the factory can ship without a live text call. */
export const STYLE_CATALOG: readonly CatalogStyle[] = [
	{
		slug: 'lego-minifig',
		name: 'LEGO minifig',
		rationale: 'Plastic brick portrait that still reads as the real person.',
		prompt:
			'Portrait of this person as a LEGO minifigure. Keep the real face likeness, hair, glasses, and expression from the reference photo. Classic LEGO plastic, accurate hairpiece and printed torso, studio lighting, plain background, square 1:1.',
	},
	{
		slug: 'muppets',
		name: 'Muppet',
		rationale: 'Felt-and-foam puppet that keeps the person recognizable.',
		prompt:
			'Portrait of this person as a Muppet. Felt, fleece, and foam; stitched mouth; glass-bead eyes. Keep hair, glasses, and likeness from the reference. Bright workshop lighting, plain backdrop, square 1:1.',
	},
	{
		slug: '8-bit-nes',
		name: '8-bit NES',
		rationale: 'Chunky pixel sprite still readable as this person.',
		prompt:
			'Portrait of this person as an 8-bit NES sprite blown up cleanly. Limited 54-color NES palette, chunky pixels, no anti-alias. Keep hair, glasses, and likeness. Solid color background, square 1:1.',
	},
	{
		slug: 'wes-anderson',
		name: 'Wes Anderson',
		rationale: 'Symmetrical pastel tableau with the real face locked.',
		prompt:
			'Centered Wes Anderson portrait of this person. Pastel palette, formal costume, deadpan expression, symmetrical framing, miniature-set lighting. Keep likeness, hair, and glasses from the reference. Square 1:1.',
	},
	{
		slug: 'pixar',
		name: 'Pixar',
		rationale: 'Appealing 3D feature-animation face, not a caricature melt.',
		prompt:
			'Pixar-style 3D character portrait of this person. Appealing proportions, subsurface skin, cinematic key light. Keep likeness, hair, and glasses from the reference. Soft studio backdrop, square 1:1.',
	},
	{
		slug: 'claymation',
		name: 'Claymation',
		rationale: 'Stop-motion clay that still looks like them.',
		prompt:
			'Aardman-like claymation portrait of this person. Thumbprint clay, wire-armature feel, practical workshop light. Keep likeness, hair, and glasses from the reference. Plain backdrop, square 1:1.',
	},
	{
		slug: 'funko',
		name: 'Funko Pop',
		rationale: 'Big-head vinyl figure with the real hair and glasses.',
		prompt:
			'Funko Pop vinyl figure of this person. Oversized head, tiny body, black-dot eyes. Keep hair, glasses, and recognizable features from the reference. Product-shot lighting, square 1:1.',
	},
	{
		slug: 'comic-noir',
		name: 'Comic noir',
		rationale: 'High-contrast ink portrait for a music-league cover.',
		prompt:
			'Bold comic-noir portrait of this person. Heavy ink, Ben-Day dots, dramatic rim light. Keep likeness, hair, and glasses from the reference. Limited palette, square 1:1.',
	},
];

function uniqueSlug(base: string, taken: Set<string>): string {
	let s: string;
	try {
		s = slugify(base);
	} catch {
		s = 'style';
	}
	if (!taken.has(s)) return s;
	let i = 2;
	while (taken.has(`${s}-${i}`)) i += 1;
	return `${s}-${i}`;
}

export const SUGGEST_COUNT_DEFAULT = 5;
export const SUGGEST_COUNT_MAX = 8;
export const LIKENESS_LOCK =
	'Keep the real face likeness, hair, glasses, and expression from the reference photo. Do not invent goatees, baldness, or glasses.';

export function clampSuggestCount(n?: number): number {
	const x = Number(n);
	if (!Number.isFinite(x)) return SUGGEST_COUNT_DEFAULT;
	return Math.max(1, Math.min(SUGGEST_COUNT_MAX, Math.round(x)));
}

export function pickCatalogStyle(existingSlugs: string[], idea?: string): StyleDraft {
	const taken = new Set(existingSlugs);
	const q = (idea ?? '').trim().toLowerCase();
	const hinted = q
		? STYLE_CATALOG.find((c) => !taken.has(c.slug) && (c.slug.includes(q.replace(/\s+/g, '-')) || c.name.toLowerCase().includes(q)))
		: undefined;
	const unused = hinted ?? STYLE_CATALOG.find((c) => !taken.has(c.slug));
	if (unused) {
		return { ...unused, slug: uniqueSlug(unused.slug, taken), source: 'catalog' };
	}
	const name = (idea ?? '').trim() || 'New style';
	const slug = uniqueSlug(name, taken);
	return {
		slug,
		name,
		source: 'catalog',
		rationale: 'Fallback prompt because every catalog lane is already in use.',
		prompt: `Stylized portrait of this person in the visual world of ${name}. ${LIKENESS_LOCK} Cohesive art direction, studio lighting, plain background, square 1:1.`,
	};
}

export function pickCatalogStyles(existingSlugs: string[], idea?: string, count?: number): StyleDraft[] {
	const want = clampSuggestCount(count);
	const taken = [...existingSlugs];
	const out: StyleDraft[] = [];
	if (out.length < want) {
		const first = pickCatalogStyle(taken, idea);
		out.push(first);
		taken.push(first.slug);
	}
	while (out.length < want) {
		const next = pickCatalogStyle(taken);
		out.push(next);
		taken.push(next.slug);
	}
	return out;
}

export function fallbackBuildPrompt(input: {
	name?: string;
	idea?: string;
	notes?: string;
	prompt?: string;
}): StyleDraft {
	const name = (input.name ?? '').trim() || (input.idea ?? '').trim() || 'New style';
	const extra = [(input.idea ?? '').trim(), (input.notes ?? '').trim()].filter(Boolean).join('. ');
	const base = (input.prompt ?? '').trim();
	const hasLock = /likeness/i.test(base);
	const prompt = base
		? hasLock
			? base
			: `${base} ${LIKENESS_LOCK} Square 1:1.`
		: `Portrait of this person in the visual world of ${name}.${extra ? ` ${extra}.` : ''} ${LIKENESS_LOCK} Cohesive art direction, studio lighting, plain background, square 1:1.`;
	return {
		slug: uniqueSlug(name, new Set()),
		name,
		prompt,
		rationale: extra || 'Built from the prompt builder.',
		source: 'catalog',
	};
}

function extractJsonValue(raw: string): unknown | null {
	const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const text = (fenced?.[1] ?? raw).trim();
	const objStart = text.indexOf('{');
	const arrStart = text.indexOf('[');
	let start = -1;
	let end = -1;
	if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
		start = objStart;
		end = text.lastIndexOf('}');
	} else if (arrStart >= 0) {
		start = arrStart;
		end = text.lastIndexOf(']');
	}
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return null;
	}
}

function draftFromObject(parsed: unknown, existingSlugs: string[], source: StyleDraft['source']): StyleDraft | null {
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const o = parsed as Record<string, unknown>;
	const name = String(o.name ?? '').trim();
	const prompt = String(o.prompt ?? '').trim();
	if (!name || !prompt) return null;
	const slug = uniqueSlug(String(o.slug ?? name), new Set(existingSlugs));
	return {
		slug,
		name,
		prompt,
		rationale: String(o.rationale ?? '').trim() || 'Brainstormed style.',
		source,
	};
}

export function parseBrainstormJson(raw: string, existingSlugs: string[]): StyleDraft | null {
	return draftFromObject(extractJsonValue(raw), existingSlugs, 'llm');
}

export function parseBrainstormList(raw: string, existingSlugs: string[]): StyleDraft[] {
	const parsed = extractJsonValue(raw);
	let items: unknown[] = [];
	if (Array.isArray(parsed)) items = parsed;
	else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { styles?: unknown }).styles)) {
		items = (parsed as { styles: unknown[] }).styles;
	}
	const taken = [...existingSlugs];
	const out: StyleDraft[] = [];
	for (const item of items) {
		const draft = draftFromObject(item, taken, 'llm');
		if (!draft) continue;
		out.push(draft);
		taken.push(draft.slug);
	}
	return out;
}

function existingLine(existing: ThemeRecord[]): string {
	return existing.map((t) => `${t.slug} (${t.name})`).join(', ') || '(none)';
}

function brainstormUserPrompt(existing: ThemeRecord[], idea?: string): string {
	const hint = (idea ?? '').trim() || 'Invent a fresh, distinctive visual world that is not already listed.';
	return `Existing avatar styles (do not copy): ${existingLine(existing)}

User idea: ${hint}

Return JSON only:
{"slug":"kebab-case","name":"Short title","prompt":"Image-generation style prompt for a 1:1 portrait. Must keep the person's real likeness, hair, glasses, and expression from a reference photo, then restyle everything else.","rationale":"one sentence why this works for a music-league group"}`;
}

function suggestUserPrompt(existing: ThemeRecord[], idea: string | undefined, count: number): string {
	const hint = idea?.trim() || 'Invent distinctive visual worlds that are not already listed.';
	return `Existing avatar styles (do not copy): ${existingLine(existing)}

User idea: ${hint}

Return JSON only with exactly ${count} styles:
{"styles":[{"slug":"kebab-case","name":"Short title","prompt":"Image-generation style prompt for a 1:1 portrait. Must keep the person's real likeness, hair, glasses, and expression from a reference photo, then restyle everything else.","rationale":"one sentence"}]}`;
}

function buildUserPrompt(input: { name?: string; idea?: string; notes?: string; prompt?: string }): string {
	return `Design one music-league avatar style prompt.

Name: ${(input.name ?? '').trim() || '(untitled)'}
Idea: ${(input.idea ?? '').trim() || '(none)'}
Builder notes: ${(input.notes ?? '').trim() || '(none)'}
Current prompt: ${(input.prompt ?? '').trim() || '(empty — write a full prompt)'}

Return JSON only:
{"slug":"kebab-case","name":"Short title","prompt":"Complete 1:1 portrait style prompt. Keep real likeness, hair, glasses, and expression from a reference photo; restyle everything else. Square 1:1.","rationale":"one sentence"}`;
}

const STYLE_SYSTEM =
	'You invent visual avatar styles for a music-league portrait factory. Reply with JSON only. Never request or emit images.';

async function completeStyleText(opts: {
	user: string;
	fetchImpl?: FetchLike;
}): Promise<string | null> {
	const fetchImpl = opts.fetchImpl;
	const key = process.env.OPENROUTER_API_KEY;
	if (!fetchImpl && !key) return null;
	const apiKey = key || 'mock';
	const impl = fetchImpl ?? fetch;
	const res = await impl(OPENROUTER_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': appBaseUrl(),
			'X-Title': 'Music League Bot - Avatar Factory brainstorm',
		},
		body: JSON.stringify({
			model: BRAINSTORM_MODEL,
			messages: [
				{ role: 'system', content: STYLE_SYSTEM },
				{ role: 'user', content: opts.user },
			],
			temperature: 0.9,
		}),
	});
	if (!res.ok) return null;
	const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
	return body.choices?.[0]?.message?.content ?? null;
}

async function completeBrainstorm(opts: {
	existing: ThemeRecord[];
	idea?: string;
	fetchImpl?: FetchLike;
}): Promise<StyleDraft> {
	const existingSlugs = opts.existing.map((t) => t.slug);
	const content = await completeStyleText({
		user: brainstormUserPrompt(opts.existing, opts.idea),
		fetchImpl: opts.fetchImpl,
	});
	if (!content) return pickCatalogStyle(existingSlugs, opts.idea);
	return parseBrainstormJson(content, existingSlugs) ?? pickCatalogStyle(existingSlugs, opts.idea);
}

function loadThemes(leagueSlug: string | undefined, ctx: FactoryCtx): ThemeRecord[] {
	const factoryDir = ctx.factoryDir ?? factoryRoot();
	const sourcesDir = ctx.sourcesDir ?? sourcesRoot();
	const state = loadState(factoryDir);
	if (!state.themes.length) {
		publicState(leagueSlug || 'boarz-ii-men', { factoryDir, sourcesDir });
	}
	return loadState(factoryDir).themes;
}

export async function suggestThemes(
	input: { idea?: string; leagueSlug?: string; count?: number },
	ctx: FactoryCtx = {},
): Promise<{ drafts: StyleDraft[] }> {
	const existing = loadThemes(input.leagueSlug, ctx);
	const existingSlugs = existing.map((t) => t.slug);
	const count = clampSuggestCount(input.count);
	const content = await completeStyleText({
		user: suggestUserPrompt(existing, input.idea, count),
		fetchImpl: ctx.fetchImpl,
	});
	const parsed = content ? parseBrainstormList(content, existingSlugs) : [];
	if (parsed.length >= count) return { drafts: parsed.slice(0, count) };
	const taken = [...existingSlugs, ...parsed.map((d) => d.slug)];
	const filler = pickCatalogStyles(taken, input.idea, count - parsed.length);
	return { drafts: [...parsed, ...filler].slice(0, count) };
}

export async function buildThemePrompt(
	input: { name?: string; idea?: string; notes?: string; prompt?: string; leagueSlug?: string },
	ctx: FactoryCtx = {},
): Promise<{ draft: StyleDraft }> {
	const existing = loadThemes(input.leagueSlug, ctx);
	const existingSlugs = existing.map((t) => t.slug);
	const content = await completeStyleText({
		user: buildUserPrompt(input),
		fetchImpl: ctx.fetchImpl,
	});
	const parsed = content ? parseBrainstormJson(content, existingSlugs) : null;
	if (parsed) return { draft: parsed };
	const fallback = fallbackBuildPrompt(input);
	fallback.slug = uniqueSlug(fallback.slug, new Set(existingSlugs));
	return { draft: fallback };
}

async function notifyStyleReady(draft: StyleDraft, fetchImpl?: FetchLike): Promise<boolean> {
	try {
		const urls = hilCallbackUrls();
		const n: Notification = {
			title: `Avatar style ready: ${draft.name}`,
			message: `${draft.rationale}\n\nSlug ${draft.slug}. Tap Factory to use it, or run implement-style to generate everyone then a group shot.`,
			click: urls.click,
			priority: 3,
			tags: ['art'],
			actions: [{ action: 'view', label: 'Factory', url: urls.click, clear: false }],
		};
		return await publishStyleHil(n, { fetchImpl });
	} catch {
		return false;
	}
}

export async function brainstormTheme(
	input: { idea?: string; leagueSlug?: string },
	ctx: FactoryCtx = {},
): Promise<{ theme: ThemeRecord; draft: StyleDraft; hilSent: boolean }> {
	const factoryDir = ctx.factoryDir ?? factoryRoot();
	const sourcesDir = ctx.sourcesDir ?? sourcesRoot();
	const state = loadState(factoryDir);
	if (!state.themes.length) {
		publicState(input.leagueSlug || 'boarz-ii-men', { factoryDir, sourcesDir });
	}
	const fresh = loadState(factoryDir);
	const draft = await completeBrainstorm({
		existing: fresh.themes,
		idea: input.idea,
		fetchImpl: ctx.fetchImpl,
	});
	const theme = createTheme(
		{ slug: draft.slug, name: draft.name, prompt: draft.prompt, attachInspiration: false },
		{ factoryDir, sourcesDir },
	);
	const hilSent = await notifyStyleReady(draft, ctx.ntfyFetchImpl);
	return { theme, draft, hilSent };
}
