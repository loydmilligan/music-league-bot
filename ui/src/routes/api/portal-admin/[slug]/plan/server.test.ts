import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { setAuth, seedPlan, seedLeagueAndSeason, makeEvent, AUTH } from '../testHelpers.js';

let db: ReturnType<typeof openLeagueDb>;
vi.mock('$lib/db/client.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const { GET } = await import('./+server.js');
const { POST: derive } = await import('./derive/+server.js');

beforeEach(() => {
	db = openLeagueDb(':memory:');
});

describe('GET /plan', () => {
	setAuth();
	it('404s an unknown slug', async () => {
		await expect(GET(makeEvent({ slug: 'nope', headers: AUTH }))).rejects.toMatchObject({ status: 404 });
	});
	it('returns an empty plan for a league with no seasons', async () => {
		seedLeagueAndSeason(db);
		db.prepare('DELETE FROM seasons WHERE league_id = 1').run();
		const res = await GET(makeEvent({ headers: AUTH }));
		expect(await res.json()).toEqual({ today: 0, overdue: 0, groups: [] });
	});
	it('derives stored tasks and groups them into a PlanView', async () => {
		seedPlan(db);
		const res = await GET(makeEvent({ headers: AUTH }));
		const plan = await res.json();
		expect([plan.today, plan.overdue]).toEqual([expect.any(Number), expect.any(Number)]);
		expect(plan.groups.length).toBeGreaterThan(0);
		const first = plan.groups[0] as { label: string; tasks: { key: string }[] };
		expect(first.label).toBe('Past due');
		expect(first.tasks.length).toBeGreaterThan(0);
		expect(first.tasks.some((t: { key: string }) => t.key === 'r1.submission')).toBe(true);
		const flat = plan.groups.flatMap((g: { tasks: { key: string; kind: string; status: string }[] }) => g.tasks);
		for (const t of flat) {
			expect(typeof t.key).toBe('string');
			expect(['content', 'ops', 'review']).toContain(t.kind);
			expect(['open', 'done', 'skipped']).toContain(t.status);
		}
	});
	it('respects ?days=0 (no future buckets)', async () => {
		seedPlan(db);
		const res = await GET(makeEvent({ url: 'http://t/plan?days=0', headers: AUTH }));
		const plan = await res.json();
		for (const g of plan.groups as { label: string }[]) {
			expect(g.label).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});
});

describe('POST /plan/derive', () => {
	setAuth();
	it('syncs the active season and reports the season number', async () => {
		seedPlan(db);
		const res = await derive(makeEvent({ url: 'http://t/plan/derive', headers: AUTH }));
		expect(await res.json()).toEqual({ ok: true, seasonNumber: 2 });
	});
});