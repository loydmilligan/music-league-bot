import { describe, expect, it, beforeEach, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { setAuth, seedLeagueAndSeason, makeEvent, AUTH } from '../testHelpers.js';

let db: ReturnType<typeof openLeagueDb>;
vi.mock('$lib/db/client.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const { POST } = await import('./+server.js');
const { GET } = await import('./[jobId]/+server.js');

beforeEach(() => {
	db = openLeagueDb(':memory:');
});

describe('POST /run', () => {
	setAuth();
	it('400s an unknown section id', async () => {
		seedLeagueAndSeason(db);
		await expect(
			POST(makeEvent({ body: { section: 'nonsense' }, url: 'http://t/run', headers: AUTH }))
		).rejects.toMatchObject({ status: 400 });
		await expect(POST(makeEvent({ body: {}, url: 'http://t/run', headers: AUTH }))).rejects.toMatchObject({
			status: 400,
		});
	});
	it('enqueues a run and returns a jobId', async () => {
		seedLeagueAndSeason(db);
		const res = await POST(makeEvent({ body: { section: 'pulse' }, url: 'http://t/run', headers: AUTH }));
		const body = await res.json();
		expect(typeof body.jobId).toBe('string');
		const row = db.prepare('SELECT status FROM portal_admin_runs WHERE id = ?').get(body.jobId) as {
			status: string;
		};
		expect(row.status).toBe('done');
	});
	it('requires auth even for a valid section', async () => {
		seedLeagueAndSeason(db);
		await expect(POST(makeEvent({ body: { section: 'pulse' }, url: 'http://t/run' }))).rejects.toMatchObject({
			status: 401,
		});
	});
});

describe('GET /run/[jobId]', () => {
	setAuth();
	it('404s an unknown job', async () => {
		seedLeagueAndSeason(db);
		await expect(GET(makeEvent({ url: 'http://t/run/nope', headers: AUTH }))).rejects.toMatchObject({
			status: 404,
		});
	});
	it('reports the enqueued run status', async () => {
		seedLeagueAndSeason(db);
		const { jobId } = await (await POST(makeEvent({ body: { section: 'moments' }, url: 'http://t/run', headers: AUTH }))).json();
		const res = await GET(makeEvent({ url: `http://t/run/${jobId}`, headers: AUTH }));
		const status = await res.json();
		expect(status.status).toBe('done');
		expect(status.updatedAt).toBeTruthy();
		expect(status.error).toBeNull();
	});
});