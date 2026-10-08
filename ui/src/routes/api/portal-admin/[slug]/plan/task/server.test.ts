import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { listTasks } from '$lib/portalAdmin/taskStore.js';
import { syncSeasonPlan } from '$lib/portalAdmin/seasonSync.js';
import { setAuth, seedPlan, makeEvent, AUTH } from '../../testHelpers.js';

let db: ReturnType<typeof openLeagueDb>;
vi.mock('$lib/db/client.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const { POST, PATCH, DELETE } = await import('./+server.js');

const taskFor = (overrides: Record<string, unknown>) => ({
	task: { key: 'k', round: 1, kind: 'content', label: 'L', notes: null, dueAt: null, status: 'open', ...overrides },
});
const url = 'http://t/plan/task';

beforeEach(() => {
	db = openLeagueDb(':memory:');
});

describe('task CRUD', () => {
	setAuth();
	it('POST creates a custom task', async () => {
		seedPlan(db);
		const res = await POST(
			makeEvent({ body: taskFor({ label: 'Write the blurb', dueAt: '2026-10-20' }), url, headers: AUTH })
		);
		expect(await res.json()).toEqual({ ok: true });
		const rows = listTasks(db, 1, 2);
		const created = rows.find((t) => t.title === 'Write the blurb')!;
		expect(created.source).toBe('custom');
		expect(created.dueAt).toBe('2026-10-20');
	});
	it('POST 400s a bad task shape', async () => {
		seedPlan(db);
		await expect(POST(makeEvent({ body: taskFor({ kind: 'politics' }), url, headers: AUTH }))).rejects.toMatchObject({
			status: 400,
		});
		await expect(
			POST(makeEvent({ body: taskFor({ label: '' }), url, headers: AUTH }))
		).rejects.toMatchObject({ status: 400 });
	});
	it('PATCH marks a derived task done without flipping its source', async () => {
		seedPlan(db);
		syncSeasonPlan(db, 1);
		const row = listTasks(db, 1, 2).find((t) => t.key === 'r1.submission')!;
		// Resend the row unchanged except for the status — the bside toggle flow.
		const res = await PATCH(
			makeEvent({
				body: { task: { key: row.key, round: row.roundNumber, kind: row.kind, label: row.title, notes: row.notes, dueAt: row.dueAt, status: 'done' } },
				url,
				headers: AUTH,
			})
		);
		expect(await res.json()).toEqual({ ok: true });
		const after = listTasks(db, 1, 2).find((t) => t.id === row.id)!;
		expect(after.status).toBe('done');
		expect(after.source).toBe('derived');
	});
	it('PATCH editing a derived row flips it to custom so derive leaves it alone', async () => {
		seedPlan(db);
		syncSeasonPlan(db, 1);
		const row = listTasks(db, 1, 2).find((t) => t.key === 'r1.submission')!;
		await PATCH(
			makeEvent({ body: taskFor({ key: 'r1.submission', label: 'Submit to MUSIC LEAGUE', status: 'open' }), url, headers: AUTH })
		);
		const after = listTasks(db, 1, 2).find((t) => t.id === row.id)!;
		expect(after.source).toBe('custom');
		expect(after.title).toBe('Submit to MUSIC LEAGUE');
	});
	it('PATCH 404s an unknown key', async () => {
		seedPlan(db);
		await expect(
			PATCH(makeEvent({ body: taskFor({ key: 'never.made' }), url, headers: AUTH }))
		).rejects.toMatchObject({ status: 404 });
	});
	it('DELETE refuses derived rows with 409', async () => {
		seedPlan(db);
		await expect(
			DELETE(makeEvent({ body: { key: 'r1.submission' }, url, headers: AUTH }))
		).rejects.toMatchObject({ status: 409 });
	});
	it('DELETE removes a custom row', async () => {
		seedPlan(db);
		await POST(makeEvent({ body: taskFor({ label: 'Temporary' }), url, headers: AUTH }));
		const row = listTasks(db, 1, 2).find((t) => t.title === 'Temporary')!;
		const res = await DELETE(makeEvent({ body: { key: row.key }, url, headers: AUTH }));
		expect(await res.json()).toEqual({ ok: true });
		expect(listTasks(db, 1, 2).some((t) => t.id === row.id)).toBe(false);
	});
	it('DELETE 400s a missing key', async () => {
		seedPlan(db);
		await expect(DELETE(makeEvent({ body: {}, url, headers: AUTH }))).rejects.toMatchObject({ status: 400 });
	});
});