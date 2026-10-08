// Portal admin — b-side section configuration (piece 4a).
//
// Two halves, deliberately separated:
//   * `PortalAdminConfig`  — the whole thing, stored in `settings` under
//     `portal_admin_config:<leagueId>`. Prompts, frequencies and run history
//     live here and NEVER leave bot-ui.
//   * `publicSections()`   — the display subset copied into `portal.json`, so
//     the published b-side can hide sections / filter KPIs / filter members
//     without learning how anything is generated.
//
// Pure: no DB, no I/O. Storage lives in store.ts.
import { z } from 'zod';

export const SECTION_IDS = [
	'thisWeek',
	'byNumbers',
	'pulse',
	'yearbook',
	'family',
	'moments'
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const FREQUENCIES = ['on-event', 'hourly', 'daily', 'weekly', 'manual'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/**
 * Stable ids for the "season so far" KPIs. `buildKpis` stamps these onto each
 * KPI; the admin picker reads this catalog (not the current selection), so a
 * KPI added later shows up automatically and needs no migration here.
 */
export const KPI_CATALOG = ['songs', 'points', 'winners', 'noteWords'] as const;
export type KpiId = (typeof KPI_CATALOG)[number];

const thisWeekCards = z.object({
	latestDigest: z.boolean(),
	currentRound: z.boolean(),
	openPolls: z.boolean(),
	themeSurvey: z.boolean()
});
const thisWeekLinks = z.object({
	spotify: z.boolean(),
	ytm: z.boolean(),
	youtube: z.boolean(),
	musicLeague: z.boolean()
});

/** `prompt: null` means "use the built-in prompt"; a string overrides it. */
const promptable = { prompt: z.string().nullable() };

export const SectionSchema = z.object({
	thisWeek: z.object({
		enabled: z.boolean(),
		frequency: z.enum(FREQUENCIES),
		cards: thisWeekCards,
		links: thisWeekLinks
	}),
	byNumbers: z.object({
		enabled: z.boolean(),
		frequency: z.enum(FREQUENCIES),
		kpis: z.array(z.enum(KPI_CATALOG))
	}),
	pulse: z.object({ enabled: z.boolean(), frequency: z.enum(FREQUENCIES), ...promptable }),
	yearbook: z.object({
		enabled: z.boolean(),
		frequency: z.enum(FREQUENCIES),
		/** null = current season; a number pins the season awards run against. */
		season: z.number().int().positive().nullable()
	}),
	family: z.object({
		enabled: z.boolean(),
		frequency: z.enum(FREQUENCIES),
		/** absent/{} = everyone. An explicit `false` excludes that member. */
		players: z.record(z.string(), z.boolean())
	}),
	moments: z.object({ enabled: z.boolean(), frequency: z.enum(FREQUENCIES), ...promptable })
});
export type SectionConfig = z.infer<typeof SectionSchema>;

const RunStateSchema = z.record(
	z.string(),
	z.object({
		lastRunAt: z.string().nullable(),
		lastStatus: z.enum(['ok', 'error']).nullable(),
		lastError: z.string().nullable()
	})
);

export const ConfigSchema = z.object({
	version: z.literal(1),
	sections: SectionSchema,
	runState: RunStateSchema
});
export type PortalAdminConfig = z.infer<typeof ConfigSchema>;

export type SectionPatch = z.input<typeof SectionSchema>;
export type ConfigPatch = { sections?: Partial<Record<SectionId, SectionPatch>> };

export function defaultSections(): SectionConfig {
	return {
		thisWeek: {
			enabled: true,
			frequency: 'on-event',
			cards: { latestDigest: true, currentRound: true, openPolls: true, themeSurvey: true },
			links: { spotify: true, ytm: true, youtube: true, musicLeague: true }
		},
		byNumbers: { enabled: true, frequency: 'daily', kpis: [...KPI_CATALOG] },
		pulse: { enabled: true, frequency: 'weekly', prompt: null },
		yearbook: { enabled: true, frequency: 'on-event', season: null },
		family: { enabled: true, frequency: 'weekly', players: {} },
		moments: { enabled: true, frequency: 'on-event', prompt: null }
	};
}

export function defaultConfig(): PortalAdminConfig {
	return { version: 1, sections: defaultSections(), runState: {} };
}

/**
 * Merge a partial save onto the current config. Unknown section ids and
 * unknown keys are dropped (zod strips), sections absent from the patch are
 * left exactly as they were, and `version`/`runState` are never caller-owned.
 *
 * The merge is deep for plain objects so a patch can flip a single card
 * (`{ cards: { openPolls: false } }`) or a single family member without
 * resending the whole map. Arrays and `null` are assigned, not merged — a
 * `prompt: null` therefore always means "reset to the built-in prompt".
 */
export function mergeConfig(
	current: PortalAdminConfig,
	patch: unknown
): PortalAdminConfig {
	const raw = (patch ?? {}) as { sections?: Record<string, unknown> };
	const incoming = (raw.sections ?? {}) as Record<string, unknown>;
	const merged: Record<string, unknown> = {};
	for (const id of SECTION_IDS) {
		merged[id] = deepMerge(current.sections[id] as unknown, incoming[id]);
	}
	const parsed = SectionSchema.safeParse(merged);
	if (!parsed.success) throw new ConfigError(parsed.error.issues[0]?.message ?? 'invalid config');
	return { version: 1, sections: parsed.data, runState: current.runState };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, patch: unknown): unknown {
	if (patch === undefined) return base;
	if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
	return out;
}

export class ConfigError extends Error {}

/** Parse a stored (or API-supplied) config. Throws ConfigError on bad shape. */
export function parseConfig(raw: unknown): PortalAdminConfig {
	const parsed = ConfigSchema.safeParse(raw);
	if (!parsed.success) {
		throw new ConfigError(parsed.error.issues[0]?.message ?? 'invalid config');
	}
	return parsed.data;
}

export function setRunState(
	config: PortalAdminConfig,
	sectionId: SectionId,
	outcome: { status: 'ok' | 'error'; error?: string | null; at: string }
): PortalAdminConfig {
	return {
		...config,
		runState: {
			...config.runState,
			[sectionId]: {
				lastRunAt: outcome.at,
				lastStatus: outcome.status,
				lastError: outcome.status === 'error' ? outcome.error ?? null : null
			}
		}
	};
}

// ── public half ──────────────────────────────────────────────────────────────
// What the published b-side is allowed to know: which sections to render,
// which KPIs to keep, which members to show, which cards/links this week.
// Prompts, frequencies and run history are NOT in here.

export interface PublicSections {
	thisWeek: { cards: z.infer<typeof thisWeekCards>; links: z.infer<typeof thisWeekLinks> };
	byNumbers: { kpis: KpiId[] };
	family: { excluded: string[] };
	enabled: Record<SectionId, boolean>;
}

export function publicSections(config: PortalAdminConfig): PublicSections {
	const s = config.sections;
	// `players` is keyed by member id with `false` = excluded; absent = shown.
	// Publishing the exclusions (rather than an inclusion list) means the
	// b-side can filter without bot-ui first enumerating every member, and a
	// member who isn't in the read model yet simply doesn't match.
	const excluded = Object.entries(s.family.players)
		.filter(([, shown]) => !shown)
		.map(([id]) => id);
	return {
		thisWeek: { cards: s.thisWeek.cards, links: s.thisWeek.links },
		byNumbers: { kpis: s.byNumbers.kpis },
		family: { excluded },
		enabled: Object.fromEntries(SECTION_IDS.map((id) => [id, s[id].enabled])) as Record<
			SectionId,
			boolean
		>
	};
}
