// Portal admin — pure helpers for the B-side tab (kept out of .svelte so the
// selection logic is unit-testable under ui's vitest tree).
import type { PortalAdminConfig, SectionCatalog } from './portalAdminApi.js';

export const SECTION_CARDS: { id: keyof PortalAdminConfig['sections']; label: string; blurb: string }[] = [
	{ id: 'thisWeek', label: 'This week', blurb: 'Latest digest · current round · open polls · theme survey cards, plus link buttons.' },
	{ id: 'byNumbers', label: 'By the numbers', blurb: 'The “season so far” KPI ribbon — pick which pills appear.' },
	{ id: 'pulse', label: 'Pulse', blurb: 'Season pulse blurb pushed to the Home screen.' },
	{ id: 'yearbook', label: 'Yearbook awards', blurb: 'Superlative awards row; pin a past season or follow the current one.' },
	{ id: 'family', label: 'Family', blurb: 'Member tiles on Home — hide the quiet ones.' },
	{ id: 'moments', label: 'Moments of the season', blurb: 'Consensus moments blurb pushed to the Home screen.' },
];

export const FREQUENCY_LABELS: Record<string, string> = {
	'on-event': 'On event',
	'hourly': 'Hourly',
	'daily': 'Daily',
	'weekly': 'Weekly',
	'manual': 'Manual only',
};

/**
 * Seed pill state from the catalog: every catalog id is ON. The stored subset
 * is deliberately ignored for seeding — a KPI (or member) added to the catalog
 * later surfaces automatically, and the persisted array only records what the
 * admin has explicitly left on at save time. An uncheck flips the pill state,
 * which is what gets written back.
 */
export function seedSelection(catalog: readonly string[]): Record<string, boolean> {
	const out: Record<string, boolean> = {};
	for (const id of catalog) out[id] = true;
	return out;
}

/** Inverse of `selection` — the currently "on" pills in catalog order. */
export function selectedIds(sel: Record<string, boolean>): string[] {
	return Object.entries(sel)
		.filter(([, on]) => on)
		.map(([id]) => id);
}

/**
 * Family pill state. Config stores `players: {id: boolean}` where an ABSENT id
 * means "shown" (and `false` = excluded). Pill state flips that convention to
 * an explicit boolean so a toggle is a plain assignment.
 */
export function familyState(players: Record<string, boolean>, members: SectionCatalog['members']): Record<string, boolean> {
	const out: Record<string, boolean> = {};
	for (const m of members) out[m.id] = players[m.id] ?? true;
	return out;
}

/**
 * Save-side: only exclusions (false) need writing — an all-shown roster saves
 * as `{}`, exactly the default. So a member deselected-and-re-enabled round-trips
 * to nothing, and a fresh league is never flooded with `true` entries.
 */
export function familyPayload(state: Record<string, boolean>): Record<string, boolean> {
	const out: Record<string, boolean> = {};
	for (const [id, shown] of Object.entries(state)) if (!shown) out[id] = false;
	return out;
}

export function fmtLastRun(run: { lastRunAt: string | null; lastStatus: string | null } | undefined): string {
	if (!run?.lastRunAt) return 'Never run';
	const t = new Date(run.lastRunAt);
	const hh = String(t.getHours()).padStart(2, '0');
	const mm = String(t.getMinutes()).padStart(2, '0');
	return run.lastStatus === 'error' ? `Failed ${hh}:${mm}` : `Updated ${hh}:${mm}`;
}

export function debounce<A extends unknown[]>(ms: number, fn: (...a: A) => void): (...a: A) => void {
	let timer: ReturnType<typeof setTimeout> | null = null;
	return (...a: A) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...a), ms);
	};
}