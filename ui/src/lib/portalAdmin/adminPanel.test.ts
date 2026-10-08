import { describe, expect, it, vi, afterEach } from 'vitest';
import {
	seedSelection,
	selectedIds,
	familyState,
	familyPayload,
	fmtLastRun,
	debounce
} from '../../../../bside/src/lib/portalAdminUi.ts';
import { createPortalAdminApi } from '../../../../bside/src/lib/portalAdminApi.ts';
import { defaultConfig } from './config.ts';

const CATALOG = ['songs', 'points', 'winners', 'noteWords'] as const;
const members = [
	{ id: 'm1', name: 'Mo' },
	{ id: 'm2', name: 'Jono' },
	{ id: 'm3', name: 'Conor' },
];

afterEach(() => vi.useRealTimers());

describe('picker selection', () => {
	it('pre-selection equals the catalog when defaults are in force', () => {
		const sel = seedSelection(CATALOG);
		expect(selectedIds(sel)).toEqual(['songs', 'points', 'winners', 'noteWords']);
	});

	it('a deselected KPI is not sent as selected', () => {
		const sel = seedSelection(CATALOG);
		sel.winners = false;
		expect(selectedIds(sel)).toEqual(['songs', 'points', 'noteWords']);
		const payload = defaultConfig();
		payload.sections.byNumbers.kpis = selectedIds(sel);
		expect(payload.sections.byNumbers.kpis).not.toContain('winners');
	});

	it('a KPI added to the catalog after a save surfaces as on (no migration)', () => {
		const sel = seedSelection([...CATALOG, 'other'] as string[]);
		expect(sel['other']).toBe(true);
	});
});

describe('family player pills', () => {
	it('absent config players renders every member shown', () => {
		const st = familyState({}, members);
		expect(Object.values(st)).toEqual([true, true, true]);
	});

	it('an explicit false exludes exactly that member', () => {
		const st = familyState({ m2: false }, members);
		expect(st).toEqual({ m1: true, m2: false, m3: true });
	});

	it('save writes only exclusions (all-shown roster serializes as {})', () => {
		expect(familyPayload({ m1: true, m2: true, m3: true })).toEqual({});
		expect(familyPayload({ m1: true, m2: false, m3: true })).toEqual({ m2: false });
	});
});

describe('run status formatting', () => {
	it('labels never-run sections', () => {
		expect(fmtLastRun(undefined)).toBe('Never run');
		expect(fmtLastRun({ lastRunAt: null, lastStatus: null })).toBe('Never run');
	});

	it('formats success and failure with local hh:mm', () => {
		const ok = fmtLastRun({ lastRunAt: '2026-10-08T12:32:00Z', lastStatus: 'ok' });
		expect(ok).toMatch(/^Updated \d{2}:\d{2}$/);
		const bad = fmtLastRun({ lastRunAt: '2026-10-08T12:32:00Z', lastStatus: 'error' });
		expect(bad).toMatch(/^Failed \d{2}:\d{2}$/);
	});
});

describe('debounce', () => {
	it('collapses rapid calls into one after the window', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const d = debounce(200, fn);
		d('a');
		d('b');
		d('c');
		vi.advanceTimersByTime(199);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenLastCalledWith('c');
	});
});

describe('optimistic save round-trip', () => {
	it('GET config → toggle a family member → PUT → GET yields the exclusion', async () => {
		const stored = defaultConfig();
		const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
			const method = (init?.method ?? 'GET') as string;
			if (method === 'GET') {
				return new Response(JSON.stringify(stored), { status: 200 });
			}
			const body = JSON.parse(String(init?.body)) as typeof stored;
			stored.sections.family.players = body.sections.family.players;
			return new Response(JSON.stringify(stored), { status: 200 });
		});
		const api = createPortalAdminApi('x', fn);
		const cfg = await api.config();
		const state = familyState(cfg.sections.family.players, members);
		state.m2 = false;
		cfg.sections.family.players = familyPayload(state);
		await api.saveConfig(cfg);
		const reloaded = await api.config();
		expect(reloaded.sections.family.players).toEqual({ m2: false });
	});
});