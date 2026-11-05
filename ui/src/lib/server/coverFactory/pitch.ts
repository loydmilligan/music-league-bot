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
import { getProject, logRequest, updateProject } from './repo.js';
import { readProjectAlternates, type AltCover } from './alternates.js';

export type ConceptMove = 'morph' | 'signature' | 'recast' | 'alternate';
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
	/** Only for move 'alternate': an id from the project's stored alternate-cover list. */
	alternateId?: string;
}

const MOVES: ConceptMove[] = ['morph', 'signature', 'recast', 'alternate'];
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

Unless an ALTERNATE COVERS list appears below, NEVER suggest an alternate cover, a different edition or replacing the artwork: every plan works on this exact cover and keeps its art style, composition, palette and text.

If the cover has no people ("no_subjects": true), the player still goes in: morph an object, or add them as a new subject.

OUTPUT: return ONLY JSON:
{"concepts":[{"move":"morph|signature|recast","title":"2-5 word name","plan":"one concrete line",
 "treatments":[{"label":"A","mode":"player|keep|remove","playerSlug":"...","clothing":"...","poseGaze":"...","notes":"..."}],
 "addSubjects":[{"label":"N1","kind":"person|animal|object","role":"main|secondary|background","position":"...","pose":"...","gaze":"...","clothing":"...","expression":"...","color_treatment":"...","focus":"sharp|soft|blurred","box":[x,y,w,h]}]}]}
JSON rules:
- "treatments" may target ONLY the existing subjects listed under EXISTING SUBJECTS below (by their label) or subjects you add in "addSubjects" (labels "N1", "N2", ... in order). Never target a label that is not in one of those two lists.
- To use anything else on the cover that is not an existing subject (an object, the sun, a building, a shape) or to introduce something new (the player's figure, a prop), put it in "addSubjects" with a provisional label N1, N2, ... ("kind" object|person|animal, "position", and "box" [x, y, width, height] as fractions 0-1 of the image, top-left origin, when you can place it) and target that label.
- Every concept EXCEPT an \"alternate\" one MUST contain at least one treatment with mode "player" for one of the listed players ("playerSlug" must be one of the slugs below). Say what the image model must do in "notes" (plus "clothing" / "poseGaze" when they change). An object or animal can take mode "player": that is how a morph works (the notes say how it becomes the player).
- mode "remove" deletes a subject; "keep" leaves it as it is. A prop you add that is not the player gets a "keep" treatment whose "notes" describe it.
- Only list subjects the plan changes; everything else is kept.
Example concept for a cover with no existing subjects:
{"move":"morph","title":"Sun Face","plan":"The setting sun is Matt's face, squinting",
 "addSubjects":[{"label":"N1","kind":"object","role":"main","position":"the setting sun, upper left","box":[0.05,0.05,0.3,0.3]}],
 "treatments":[{"label":"N1","mode":"player","playerSlug":"matt","notes":"the sun is Matt's face, squinting into the haze, same glow and colors as the sun"}]}`;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function playersOf(leagueSlug: string | null, projectId: number): PlayerOption[] {
	if (leagueSlug) return listPlayers(leagueSlug, projectId);
	return LEAGUES.flatMap((l) => listPlayers(l, projectId));
}

const ALTERNATE_RULES = `ALTERNATE COVERS: this song also has the editions listed below. You may pitch a concept with "move":"alternate" and "alternateId" set to exactly one listed id, when switching to that edition enables a gag the current cover cannot. Its "plan" is one line describing the gag the alternate enables (for example "Jon as Fat Mike's dad on the Ribbed-era cover"). An alternate concept needs no treatments or addSubjects. Pitch at most two alternates; every other concept keeps the current cover.`;

function buildPrompt(b: Breakdown, players: { slug: string; name: string; profile: string }[], count: number, alternates: AltCover[] = []): string {
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
		`EXISTING SUBJECTS are exactly: ${b.subjects.length ? b.subjects.map((x) => `${x.label} (${x.kind}, ${x.position || 'unplaced'})`).join('; ') : 'none'}. Anything else goes in addSubjects.`,
		'',
		...(alternates.length
			? [ALTERNATE_RULES, ...alternates.map((a) => `- id: ${a.id} | ${a.title} | ${a.kind} | ${a.date ?? 'undated'}`), '']
			: []),
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

export function cleanConcepts(raw: unknown, b: Breakdown, names: Map<string, string>, count: number, alternates: AltCover[] = []): Concept[] {
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
		if (c.move === 'alternate') {
			// No player treatment needed: the gag is the edition itself. Only ids from the shown list survive.
			const alternateId = str(c.alternateId);
			if (!alternateId || !alternates.some((a) => a.id === alternateId)) continue;
			out.push({ id: `c-${randomUUID().slice(0, 8)}`, move: 'alternate', title: str(c.title) || plan.slice(0, 40), plan, addSubjects: [], treatments: [], alternateId });
			if (out.length >= count) break;
			continue;
		}
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
		// Repair: a player treatment aimed at a label that is neither existing nor provisional (live: "A" meaning
		// the sun on a cover whose breakdown had no subjects) becomes a synthesized added object subject.
		const synth = new Map<string, string>();
		const rawTs = (Array.isArray(c.treatments) ? c.treatments : []).map((t) => {
			if (!t || typeof t !== 'object') return t;
			const o = t as Record<string, unknown>;
			const given = str(o.label);
			const label = remap.get(given) ?? given;
			if (!given || valid.has(label) || o.mode !== 'player' || !names.has(str(o.playerSlug))) return t;
			let prov = synth.get(given);
			if (!prov) {
				prov = `N${adds.length + 1}`;
				synth.set(given, prov);
				adds.push(normalizeBreakdown({ subjects: [{ label: prov, kind: 'object', role: 'main', position: str(o.notes) || plan }] }).subjects[0]);
				valid.add(prov);
			}
			return { ...o, label: prov };
		});
		const treatments = rawTs
			.map((t) => cleanTreatment(t, valid, names, remap))
			.filter((t): t is Treatment => t !== null);
		if (!treatments.some((t) => t.mode === 'player')) continue; // a pitch must put a player on the cover
		// Props with no treatment still have to reach the generation prompt: describe them with a keep note.
		for (const a of adds) {
			if (treatments.some((t) => t.label === a.label)) continue;
			const desc = [a.pose, a.clothing, a.expression, a.color_treatment].filter((x) => x.trim()).join(', ');
			treatments.push({ label: a.label, mode: 'keep', notes: desc || plan });
		}
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
	const alternates = readProjectAlternates(db, projectId);
	const prompt = buildPrompt(breakdown, players, count, alternates);
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
		const concepts = cleanConcepts(parseModelJson(r.text), breakdown, names, count, alternates);
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

const IDEA_MAX = 6;
const IDEA_WORDS = 8;

export function cleanIdeas(raw: unknown): string[] {
	const list = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { ideas?: unknown }).ideas : raw;
	if (!Array.isArray(list)) return [];
	const out: string[] = [];
	for (const x of list) {
		const t = str(x).replace(/\s+/g, ' ');
		if (!t || t.split(' ').length > IDEA_WORDS || out.includes(t)) continue;
		out.push(t);
		if (out.length >= IDEA_MAX) break;
	}
	return out;
}

/** Short wearable / prop / pose gag ideas drawn from one player's profile; cached in identities_json["ideas:<slug>"]. */
export async function playerIdeas(
	db: Database.Database, projectId: number, slug: string, o: { fetchImpl?: FetchLike } = {},
): Promise<string[]> {
	assertGenerationAllowed(); // paid call
	const project = getProject(db, projectId);
	if (!project) throw new Error(`cover project ${projectId} not found`);
	const readCache = (): Record<string, unknown> => {
		try {
			const v = JSON.parse(project.identities_json ?? '{}');
			return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
		} catch { return {}; }
	};
	const key = `ideas:${slug}`;
	const hit = readCache()[key];
	if (Array.isArray(hit) && hit.every((x) => typeof x === 'string')) return hit as string[];

	const player = playersOf(project.league_slug, project.id).find((r) => r.slug === slug);
	if (!player) throw new Error(`unknown player ${slug}`);
	const profile = loadProfileExcerpt(db, { slug, name: player.name }).text;
	if (!profile.trim()) return [];
	const model = getPinnedCoverModel(db, 'pitch');
	if (!model) throw new Error('No pitch model available: pin or add a text model for concept pitches');

	const prompt = [
		`You write gag ideas for doctoring album covers of a private music league. List up to ${IDEA_MAX} short ideas (at most ${IDEA_WORDS} words each) for things ${player.name} could be shown wearing, holding, or doing in a cover.`,
		`Each must be concrete, visual and specific to THIS player, drawn from how the others see him/her and his/her running jokes in the profile. No generic props (no sunglasses, no guitar, no trophy) and no cheap literal mashups.`,
		`Examples of the shape: "jean shorts", "holding a pocket bidet".`,
		`Reply with JSON only: {"ideas": ["...", "..."]}`,
		`\nProfile excerpt for ${player.name}:\n${profile}`,
	].join('\n');

	const base = { project_id: projectId, version_id: null, step: 'pitch' as const, model_id: model, provider: 'openrouter', cost_estimated: 0 };
	const t0 = Date.now();
	let r;
	try {
		r = await chatWithImages({ model, prompt, imageDataUrls: [], fetchImpl: o.fetchImpl, timeoutMs: TIMEOUT_MS });
	} catch (e) {
		logRequest(db, {
			...base, latency_ms: Date.now() - t0,
			cost_usd: e instanceof ProviderError ? (e.failedCostUsd ?? null) : null,
			outcome: 'error',
			error_reason: e instanceof ProviderError ? e.reason : e instanceof Error ? e.message.slice(0, 200) : 'error',
		});
		throw e;
	}
	const ideas = cleanIdeas(parseModelJson(r.text));
	logRequest(db, {
		...base, latency_ms: r.latencyMs, cost_usd: r.costUsd,
		outcome: ideas.length ? 'ok' : 'error', error_reason: ideas.length ? null : 'no usable ideas',
	});
	if (!ideas.length) throw new Error('no usable ideas');
	// Re-read so concurrent identity writes since the model call survive.
	const fresh = getProject(db, projectId);
	let cur: Record<string, unknown> = {};
	try { cur = JSON.parse(fresh?.identities_json ?? '{}') ?? {}; } catch { /* start clean */ }
	cur[key] = ideas;
	updateProject(db, projectId, { identities_json: JSON.stringify(cur) });
	return ideas;
}
