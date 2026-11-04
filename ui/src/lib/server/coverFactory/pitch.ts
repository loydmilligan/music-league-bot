import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FetchLike } from '../avatarFactory/openrouter.js';
import { ProviderError } from '../avatarFactory/errors.js';
import { assertGenerationAllowed } from '../avatarFactory/pause.js';
import { normalizeImage } from '../avatarFactory/normalize.js';
import { letter, normalizeBreakdown, parseModelJson, type Breakdown, type Subject } from './breakdown.js';
import { chatWithImages } from './chat.js';
import { listPlayers, type PlayerOption } from './inputs.js';
import { getModelByModelId } from '$lib/db/aiModels.js';
import { parseKinds } from '$lib/models/kinds.js';
import { getPinnedCoverModel } from './models.js';
import { coverFile } from './paths.js';
import { loadProfileExcerpt } from './profiles.js';
import type { Treatment } from './prompt.js';
import { getProject, logRequest } from './repo.js';

export type ConceptMove = 'morph' | 'signature' | 'recast';
export interface Concept {
	id: string;
	move: ConceptMove;
	title: string;
	/** One concrete line, e.g. "Shane's face as the mound on the flesh cube". */
	plan: string;
	/** New subjects this concept introduces, provisionally labeled N1, N2, … (real labels assigned by applyConcept). */
	addSubjects: Subject[];
	/** Keyed by existing subject labels or by the addSubjects' provisional labels. */
	treatments: Treatment[];
}

const MOVES: ConceptMove[] = ['morph', 'signature', 'recast'];
const MODES = new Set(['player', 'keep', 'remove']);
const TIMEOUT_MS = 120_000;
// Same league fallback as service.ts playersFor (kept local: service imports this module).
const LEAGUES = ['boarz-ii-men', 'second-best', 'hip-jammers'];

export const PITCH_PROMPT = `You are the gag writer for a private music league's weekly digest. Each round, a player's song gets its album cover doctored so that player is slipped into it; the digest shows a wipe from the real cover (image 1, described by the breakdown JSON below) to the doctored one. Pitch concrete gag plans for THIS cover starring the listed player(s).

TASTE BAR: the gag must be funny for that player. It should land because of who they are (their running jokes, reputation, habits, how the others see them, from the profile excerpts below) or because the role they take on the cover says something about them. A cheap literal mashup (a face pasted onto butt cheeks, a head stuck on an object for no reason) is a failure even if it would render cleanly. If a plan would be just as funny with any other player's name in it, it is not good enough; a morph is acceptable when the profile is thin.

THE MOVES (use these exact strings in "move"):
- "morph": something already on the cover becomes the player: an object, animal or shape turns into their face or body, rendered in the cover's own style. This is the fallback: always possible, even on a cover with no people. When the profiles give you nothing real to build on, pitch more morphs rather than inventing traits.
- "signature": bring in the player's known signature thing (a running joke, garment, habit or obsession from their profile) and put it on the cover where it belongs in the composition.
- "recast": the player takes an unexpected role on the cover: a different figure, animal or character than the obvious one, in a way that says something about them or about how the others see them.

STYLE ANCHORS (plans Matt actually liked; one concrete line each, naming the player and exactly what changes where):
- "Shane's face as the mound on the flesh cube" (morph)
- "Matt as the leashed tiger on all fours, leash from the woman's hand to his neck" (recast)
- "Berto's butt in jean shorts" (signature)
Write every "plan" like these: short, specific, visual, no hedging, no explanation of why it is funny.

NEVER suggest an alternate cover, a different edition or replacing the artwork. Every plan works on this exact cover and keeps its art style, composition, palette and text.

If the cover has no people ("no_subjects": true), the player still goes in: morph an object, or add them as a new subject.

OUTPUT: return ONLY JSON:
{"concepts":[{"move":"morph|signature|recast","title":"2-5 word name","plan":"one concrete line",
 "treatments":[{"label":"A","mode":"player|keep|remove","playerSlug":"...","clothing":"...","poseGaze":"...","notes":"..."}],
 "addSubjects":[{"label":"N1","kind":"person|animal|object","role":"main|secondary|background","position":"...","pose":"...","gaze":"...","clothing":"...","expression":"...","color_treatment":"...","focus":"sharp|soft|blurred","box":[x,y,w,h]}]}]}
JSON rules:
- "treatments" refer to existing subjects by their breakdown label (A, B, ...) or to subjects you add as "N1", "N2", ... in "addSubjects" order. Only list subjects the plan changes; everything else is kept.
- mode "player" puts a player into that subject: "playerSlug" must be one of the slugs listed below; say what the image model must do in "notes" (plus "clothing" / "poseGaze" when they change). An object or animal can take mode "player" too: that is how a morph works (the notes say how it becomes the player).
- mode "remove" deletes a subject; "keep" leaves it as it is.
- "addSubjects" lists things the plan must introduce that are not on the cover (the player's figure, a prop). Describe each in the cover's style and give a "box" ([x, y, width, height] as fractions 0-1 of the image, top-left origin) when you can place it. Leave it empty when the plan only changes existing subjects.`;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function playersOf(leagueSlug: string | null, projectId: number): PlayerOption[] {
	if (leagueSlug) return listPlayers(leagueSlug, projectId);
	return LEAGUES.flatMap((l) => listPlayers(l, projectId));
}

function buildPrompt(b: Breakdown, players: { slug: string; name: string; profile: string }[], count: number): string {
	const spread = count >= 3 ? ', at least one of each move' : '';
	const who = players
		.map((p) => `- ${p.name} (slug: ${p.slug})\n  Profile excerpt:\n${p.profile ? p.profile.replace(/^/gm, '    ') : '    (no profile on file)'}`)
		.join('\n');
	const several = players.length > 1 ? ' Spread the concepts across the players.' : '';
	return [
		PITCH_PROMPT,
		'',
		`Pitch exactly ${count} concepts, spread across the three moves${spread}.${several}`,
		'',
		'PLAYERS:',
		who,
		'',
		'COVER BREAKDOWN (image 1):',
		JSON.stringify(b),
	].join('\n');
}

function cleanTreatment(raw: unknown, valid: Set<string>, names: Map<string, string>, remap: Map<string, string> = new Map()): Treatment | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const rawLabel = str(o.label);
	const label = remap.get(rawLabel) ?? rawLabel;
	if (!valid.has(label) || !MODES.has(String(o.mode))) return null;
	const mode = o.mode as Treatment['mode'];
	const slug = str(o.playerSlug);
	if (slug && !names.has(slug)) return null;
	if (mode === 'player' && !slug) return null;
	const t: Treatment = { label, mode };
	if (slug) {
		t.playerSlug = slug;
		t.playerName = names.get(slug);
	}
	for (const k of ['age', 'gender', 'clothing', 'poseGaze', 'styleMatch', 'notes'] as const) {
		const v = str(o[k]);
		if (v) t[k] = v;
	}
	return t;
}

/**
 * Keep only treatments for a known label (`validLabels`) with a valid mode; a playerSlug must be a key of
 * `names` (slug -> display name), and playerName is refilled from it. Used for model output and client-sent concepts.
 */
export function cleanTreatments(raw: unknown, validLabels: Iterable<string>, names: Map<string, string>): Treatment[] {
	const valid = new Set(validLabels);
	return (Array.isArray(raw) ? raw : []).map((t) => cleanTreatment(t, valid, names)).filter((t): t is Treatment => t !== null);
}

/** True when the ai_models row says the model takes image input. */
function acceptsImages(db: Database.Database, model: string): boolean {
	const row = getModelByModelId(db, model);
	if (!row) return false;
	const kinds = parseKinds(row.kinds);
	return row.cap_vision === 1 || kinds.includes('vision') || kinds.includes('multimodal');
}

function cleanConcepts(raw: unknown, b: Breakdown, names: Map<string, string>, count: number): Concept[] {
	const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).concepts : undefined;
	if (!Array.isArray(list)) return [];
	const existing = b.subjects.map((s) => s.label);
	const out: Concept[] = [];
	for (const item of list) {
		if (!item || typeof item !== 'object') continue;
		const c = item as Record<string, unknown>;
		if (!MOVES.includes(c.move as ConceptMove)) continue;
		const plan = str(c.plan);
		if (!plan) continue;
		const rawAdds = Array.isArray(c.addSubjects) ? c.addSubjects : [];
		// normalizeBreakdown applies the subject rules (role/kind/box); then force provisional labels N1, N2, …
		const adds = normalizeBreakdown({ subjects: rawAdds }).subjects;
		const remap = new Map<string, string>();
		adds.forEach((s, i) => {
			const prov = `N${i + 1}`;
			const given = str((rawAdds[i] as Record<string, unknown> | null)?.label);
			if (given && !existing.includes(given)) remap.set(given, prov);
			s.label = prov;
			delete s.conceptId;
		});
		const valid = new Set([...existing, ...adds.map((s) => s.label)]);
		const treatments = (Array.isArray(c.treatments) ? c.treatments : [])
			.map((t) => cleanTreatment(t, valid, names, remap))
			.filter((t): t is Treatment => t !== null);
		out.push({ id: `c-${randomUUID().slice(0, 8)}`, move: c.move as ConceptMove, title: str(c.title) || plan.slice(0, 40), plan, addSubjects: adds, treatments });
		if (out.length >= count) break;
	}
	return out;
}

export async function pitchConcepts(
	db: Database.Database, projectId: number, o: { playerSlugs: string[]; count?: number; fetchImpl?: FetchLike },
): Promise<Concept[]> {
	assertGenerationAllowed(); // paid call
	const project = getProject(db, projectId);
	if (!project) throw new Error(`cover project ${projectId} not found`);
	if (!project.breakdown_json) throw new Error('read the cover first');
	const breakdown = normalizeBreakdown(JSON.parse(project.breakdown_json));
	const count = Math.min(Math.max(Math.round(o.count ?? 6), 1), 12);
	const model = getPinnedCoverModel(db, 'pitch');
	if (!model) throw new Error('No pitch model available: pin or add a text model for concept pitches');

	const roster = playersOf(project.league_slug, project.id);
	const players = o.playerSlugs.map((slug) => {
		const p = roster.find((r) => r.slug === slug);
		if (!p) throw new Error(`unknown player ${slug}`);
		return { slug, name: p.name, profile: loadProfileExcerpt(db, { slug, name: p.name }).text };
	});
	const names = new Map(players.map((p) => [p.slug, p.name]));
	const prompt = buildPrompt(breakdown, players, count);
	// Text-only pitch models get the breakdown alone (the prompt describes the cover in JSON either way).
	const images = acceptsImages(db, model)
		? [(await normalizeImage(readFileSync(coverFile(project.cover_rel)), 'cover.jpg')).dataUrl]
		: [];

	const base = { project_id: projectId, version_id: null, step: 'pitch' as const, model_id: model, provider: 'openrouter', cost_estimated: 0 };
	const t0 = Date.now();
	let r;
	try {
		r = await chatWithImages({ model, prompt, imageDataUrls: images, fetchImpl: o.fetchImpl, timeoutMs: TIMEOUT_MS });
	} catch (e) {
		logRequest(db, {
			...base, latency_ms: Date.now() - t0,
			cost_usd: e instanceof ProviderError ? (e.failedCostUsd ?? null) : null,
			outcome: 'error',
			error_reason: e instanceof ProviderError ? e.reason : e instanceof Error ? e.message.slice(0, 200) : 'error',
		});
		throw e;
	}
	try {
		const concepts = cleanConcepts(parseModelJson(r.text), breakdown, names, count);
		if (!concepts.length) throw new Error('no usable concepts');
		logRequest(db, { ...base, latency_ms: r.latencyMs, cost_usd: r.costUsd, outcome: 'ok', error_reason: null });
		return concepts;
	} catch (e) {
		logRequest(db, {
			...base, latency_ms: r.latencyMs, cost_usd: r.costUsd, outcome: 'error',
			error_reason: e instanceof Error ? e.message.slice(0, 200) : 'error',
		});
		throw e;
	}
}

/**
 * Add the concept's new subjects (next free letters) and merge its treatments over `current` by label.
 * Idempotent per concept id: subjects already added by this concept are reused, not added again.
 */
export function applyConcept(b: Breakdown, current: Treatment[], c: Concept): { breakdown: Breakdown; treatments: Treatment[] } {
	const subjects = b.subjects.map((s) => ({ ...s }));
	const used = new Set(subjects.map((s) => s.label));
	const already = subjects.filter((s) => s.conceptId === c.id);
	const remap = new Map<string, string>();
	let k = 0;
	c.addSubjects.forEach((s, i) => {
		if (already[i]) {
			remap.set(s.label, already[i].label);
			return;
		}
		while (used.has(letter(k))) k++;
		const label = letter(k);
		used.add(label);
		remap.set(s.label, label);
		subjects.push({ ...s, label, conceptId: c.id });
	});
	const incoming = c.treatments
		.map((t) => ({ ...t, label: remap.get(t.label) ?? t.label }))
		.filter((t) => used.has(t.label));
	const byLabel = new Map(incoming.map((t) => [t.label, t]));
	const merged = current.map((t) => byLabel.get(t.label) ?? t);
	for (const t of byLabel.values()) if (!current.some((x) => x.label === t.label)) merged.push(t);
	return {
		breakdown: { ...b, subjects, no_subjects: subjects.filter((s) => s.kind !== 'object').length === 0 },
		treatments: merged,
	};
}
