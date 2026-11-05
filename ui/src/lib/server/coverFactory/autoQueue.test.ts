import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import type { Notification } from '$lib/digest/ntfy.js';

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database }));
vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => state.db };
});

import {
	APPROVAL_TIMEOUT_MS, BUDGET_DENIED_NOTE, COVER_AUTO_TOPIC, enqueueCoverAuto, getAutoJob, publishCoverAutoAlert,
	resolveCoverAutoApproval, startCoverAutoRunner, stopCoverAutoRunner, tickCoverAuto, type TickDeps,
} from './autoQueue.js';
import { createProject, logRequest } from './repo.js';
import { setAutoLeague } from './podium.js';
import { runAction } from './service.js';
import { POST as APPROVE } from '../../../routes/api/cover-factory/auto/approve/+server.js';
import { POST as DENY } from '../../../routes/api/cover-factory/auto/deny/+server.js';

const SPOT = 'https://i.scdn.co/image/abc';
const HAND = 'https://example.com/my-photoshop.jpg';
let db: Database.Database;
let roundId: number;
let offRoundId: number;

function round(slug: string, ml: string): number {
	const leagueId = (db.prepare('SELECT id FROM leagues WHERE slug = ?').get(slug) as { id: number }).id;
	return upsertRound(db, upsertSeason(db, leagueId, 1, 'active'), { mlRoundId: ml, name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
}
function draft(r: number, podium: unknown): void {
	db.prepare(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, generated_at) VALUES (?, ?, '', '', '2026-11-04T00:00:00Z')`).run(`d-${r}`, r);
	db.prepare(`INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES (?, ?, 'podium', 0, 'default', ?)`)
		.run(`d-${r}-podium`, `d-${r}`, JSON.stringify(podium));
}
const podiumJson = (r: number) => (db.prepare(`SELECT content_json FROM digest_sections WHERE id = ?`).get(`d-${r}-podium`) as { content_json: string }).content_json;
const slots = (r = roundId) => db.prepare('SELECT * FROM cover_podium_slots WHERE round_id = ? ORDER BY rank, id').all(r) as
	{ id: number; rank: number; title: string; status: string; note: string | null; submission_id: number | null; project_id: number | null }[];
const PODIUM = {
	title: 'Podium',
	items: [
		{ rank: 1, title: 'Linoleum', artist: 'NOFX', coverUrl: SPOT },
		{ rank: 2, title: 'Handy', artist: 'H', coverUrl: HAND },
		{ rank: 3, title: 'Third', artist: 'T', coverUrl: SPOT },
		{ rank: 4, title: 'Fourth', artist: 'F', coverUrl: SPOT },
	],
};

/** Fake runSlot: marks the slot done (or returns a scripted outcome), records the cap and overlap. */
function fakeRun(script: Record<string, string> = {}) {
	const calls: { slotId: number; cap: number }[] = [];
	let live = 0;
	let maxLive = 0;
	const fn = (async (d: Database.Database, _r: number, slotId: number, budget: { capUsd: number }) => {
		live++;
		maxLive = Math.max(maxLive, live);
		calls.push({ slotId, cap: budget.capUsd });
		await new Promise((r) => setTimeout(r, 2));
		const title = (d.prepare('SELECT title FROM cover_podium_slots WHERE id = ?').get(slotId) as { title: string }).title;
		const out = script[`${title}#${calls.filter((c) => c.slotId === slotId).length}`] ?? script[title] ?? 'done';
		if (out === 'done' || out === 'failed') d.prepare('UPDATE cover_podium_slots SET status = ? WHERE id = ?').run(out, slotId);
		live--;
		return out;
	}) as unknown as NonNullable<TickDeps['runSlot']>;
	return { fn, calls, maxLive: () => maxLive };
}

beforeEach(() => {
	db = openLeagueDb(':memory:');
	state.db = db;
	seedLeagues(db);
	roundId = round('boarz-ii-men', 'r-on');
	offRoundId = round('sssc', 'r-off');
	db.prepare(`INSERT INTO ml_submissions (id, round_id, spotify_uri, title, album, artists, album_art_url, created_at) VALUES (1, ?, 'spotify:track:a', 'Linoleum', 'Punk', 'NOFX', ?, datetime('now'))`).run(roundId, SPOT);
	draft(roundId, PODIUM);
	draft(offRoundId, PODIUM);
	process.env.NTFY_TOKEN = 'secret';
	vi.stubGlobal('fetch', async () => { throw new Error('no network in tests'); });
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	stopCoverAutoRunner();
});

describe('enqueueCoverAuto', () => {
	it('ON league: one slot per medal item, hand-made skipped, a queued $1 job', () => {
		const r = enqueueCoverAuto(db, roundId)!;
		expect(r.created).toBe(3);
		expect(r.job).toMatchObject({ round_id: roundId, status: 'queued', cap_usd: 1, hil_token: null });
		expect(slots().map((s) => [s.rank, s.title, s.status, s.note, s.submission_id])).toEqual([
			[1, 'Linoleum', 'pending', null, 1],
			[2, 'Handy', 'skipped', 'hand-made cover kept', null],
			[3, 'Third', 'pending', null, null],
		]);
	});
	it('OFF league: nothing created and the draft is byte-identical', () => {
		const before = podiumJson(offRoundId);
		expect(enqueueCoverAuto(db, offRoundId)).toBeNull();
		expect(slots(offRoundId)).toEqual([]);
		expect(getAutoJob(db, offRoundId)).toBeUndefined();
		expect(podiumJson(offRoundId)).toBe(before);
	});
	it('a league switched off gets nothing', () => {
		setAutoLeague(db, 'boarz-ii-men', false);
		expect(enqueueCoverAuto(db, roundId)).toBeNull();
		expect(slots()).toEqual([]);
	});
	it('idempotent: re-enqueue reuses the live job and keeps done slots', () => {
		const a = enqueueCoverAuto(db, roundId)!;
		db.prepare(`UPDATE cover_podium_slots SET status = 'done' WHERE title = 'Linoleum'`).run();
		db.prepare(`UPDATE cover_auto_jobs SET status = 'awaiting_approval', hil_token = 'tok', cap_usd = 1 WHERE id = ?`).run(a.job.id);
		const b = enqueueCoverAuto(db, roundId)!;
		expect(b.created).toBe(0);
		expect(b.job).toMatchObject({ id: a.job.id, status: 'awaiting_approval', hil_token: 'tok' });
		expect(slots().map((s) => s.status)).toEqual(['done', 'skipped', 'pending']);
		expect((db.prepare('SELECT COUNT(*) AS n FROM cover_auto_jobs').get() as { n: number }).n).toBe(1);
	});
	it('a finished job is re-queued at $1; failed slots retry only for run-now', () => {
		const a = enqueueCoverAuto(db, roundId)!;
		db.prepare(`UPDATE cover_podium_slots SET status = 'failed', note = 'x' WHERE title = 'Third'`).run();
		db.prepare(`UPDATE cover_auto_jobs SET status = 'done', cap_usd = 2 WHERE id = ?`).run(a.job.id);
		expect(enqueueCoverAuto(db, roundId)!.job).toMatchObject({ id: a.job.id, status: 'queued', cap_usd: 1 });
		expect(slots().find((s) => s.title === 'Third')!.status).toBe('failed');
		enqueueCoverAuto(db, roundId, { retryFailed: true });
		expect(slots().find((s) => s.title === 'Third')).toMatchObject({ status: 'pending', note: null });
	});
});

describe('tickCoverAuto', () => {
	it('runs pending slots one at a time, then marks the job done and writes the podium', async () => {
		enqueueCoverAuto(db, roundId);
		const before = podiumJson(roundId);
		const run = fakeRun();
		const [a, b] = await Promise.all([tickCoverAuto(db, { runSlot: run.fn }), tickCoverAuto(db, { runSlot: run.fn })]);
		expect(a).toEqual({ roundId, status: 'done' });
		expect(b).toBeNull(); // one tick at a time
		expect(run.calls.map((c) => slots().find((s) => s.id === c.slotId)!.title)).toEqual(['Linoleum', 'Third']);
		expect(run.calls.every((c) => c.cap === 1)).toBe(true);
		expect(run.maxLive()).toBe(1);
		expect(getAutoJob(db, roundId)!.status).toBe('done');
		// writePodiumCover re-applied the slots: the hand-made note now rides on the draft.
		const after = JSON.parse(podiumJson(roundId));
		expect(podiumJson(roundId)).not.toBe(before);
		expect(after._coverNotes).toEqual({ '2': 'hand-made cover kept' });
		expect(after.items[1].coverUrl).toBe(HAND);
		expect(await tickCoverAuto(db, { runSlot: run.fn })).toBeNull(); // nothing queued
	});

	it('one job at a time overall: a concurrent tick with another queued round returns null', async () => {
		const other = round('second-best', 'r-sb');
		draft(other, PODIUM);
		enqueueCoverAuto(db, roundId);
		enqueueCoverAuto(db, other);
		const run = fakeRun();
		const [a, b] = await Promise.all([tickCoverAuto(db, { runSlot: run.fn }), tickCoverAuto(db, { runSlot: run.fn })]);
		expect(a).toEqual({ roundId, status: 'done' });
		expect(b).toBeNull();
		expect(run.maxLive()).toBe(1);
		expect(getAutoJob(db, other)!.status).toBe('queued');
		expect(await tickCoverAuto(db, { runSlot: run.fn })).toEqual({ roundId: other, status: 'done' });
	});

	it('crossing $1 sends exactly one mlb-alert notification and parks the job', async () => {
		enqueueCoverAuto(db, roundId);
		const p = createProject(db, { title: 'x', source: 'upload', round_id: roundId, spotify_uri: null, league_slug: null, cover_rel: 'c.png', cover_url: null });
		logRequest(db, { project_id: p.id, version_id: null, step: 'generate', model_id: 'm', provider: 'openrouter', latency_ms: 1, cost_usd: 0.95, cost_estimated: 0, outcome: 'ok', error_reason: null });
		db.prepare(`UPDATE cover_podium_slots SET project_id = ? WHERE title = 'Linoleum'`).run(p.id);
		const sent: Notification[] = [];
		const notify = vi.fn(async (n: Notification) => { sent.push(n); return true; });
		const run = fakeRun({ Linoleum: 'needs_approval' });
		expect(await tickCoverAuto(db, { runSlot: run.fn, notify })).toEqual({ roundId, status: 'awaiting_approval' });
		expect(await tickCoverAuto(db, { runSlot: run.fn, notify })).toBeNull();
		expect(notify).toHaveBeenCalledTimes(1);
		expect(run.calls).toHaveLength(1); // parked before Third
		const job = getAutoJob(db, roundId)!;
		expect(job.status).toBe('awaiting_approval');
		expect(job.hil_token).toBeTruthy();
		expect(job.notified_at).toBeTruthy();
		const n = sent[0];
		expect(n.message).toBe(`Cover Factory R${roundId}: $0.95 spent, next cover needs ~$0.20 — approve up to $2.00?`);
		expect(n.click).toMatch(/\/cover-factory$/);
		const [approve, deny] = n.actions!;
		expect(approve).toMatchObject({ label: 'Approve', method: 'POST', body: JSON.stringify({ token: job.hil_token }) });
		expect(approve.url).toMatch(/\/api\/cover-factory\/auto\/approve$/);
		expect(deny.url).toMatch(/\/api\/cover-factory\/auto\/deny$/);
		expect(approve.headers).toMatchObject({ Authorization: 'Bearer secret' });
	});

	it('after approval the job resumes with a $2 cap', async () => {
		enqueueCoverAuto(db, roundId);
		const run = fakeRun({ 'Linoleum#1': 'needs_approval' });
		await tickCoverAuto(db, { runSlot: run.fn, notify: async () => true });
		const token = getAutoJob(db, roundId)!.hil_token!;
		expect(resolveCoverAutoApproval(db, token, 'approve')).toMatchObject({ ok: true, job: { status: 'queued', cap_usd: 2, hil_token: null } });
		expect(resolveCoverAutoApproval(db, token, 'approve')).toEqual({ ok: false, reason: 'invalid token' }); // single use
		expect(await tickCoverAuto(db, { runSlot: run.fn, notify: async () => true })).toEqual({ roundId, status: 'done' });
		expect(run.calls.slice(1).map((c) => c.cap)).toEqual([2, 2]);
	});

	it('an unanswered approval times out after 24 h: remaining slots fail "budget not approved"', async () => {
		const t0 = Date.parse('2026-11-04T12:00:00Z');
		enqueueCoverAuto(db, roundId, { now: t0 });
		const run = fakeRun({ Linoleum: 'needs_approval' });
		await tickCoverAuto(db, { runSlot: run.fn, notify: async () => true, now: () => t0 });
		await tickCoverAuto(db, { runSlot: run.fn, now: () => t0 + APPROVAL_TIMEOUT_MS - 1000 });
		expect(getAutoJob(db, roundId)!.status).toBe('awaiting_approval');
		await tickCoverAuto(db, { runSlot: run.fn, now: () => t0 + APPROVAL_TIMEOUT_MS + 1000 });
		expect(getAutoJob(db, roundId)).toMatchObject({ status: 'done', hil_token: null });
		expect(slots().map((s) => [s.title, s.status, s.note])).toEqual([
			['Linoleum', 'failed', BUDGET_DENIED_NOTE], ['Handy', 'skipped', 'hand-made cover kept'], ['Third', 'failed', BUDGET_DENIED_NOTE],
		]);
		expect(JSON.parse(podiumJson(roundId))._coverNotes).toMatchObject({ '1': BUDGET_DENIED_NOTE, '3': BUDGET_DENIED_NOTE });
	});

	it('paused: the job goes back to the queue with its slot still pending', async () => {
		enqueueCoverAuto(db, roundId);
		const run = fakeRun({ 'Linoleum#1': 'paused' });
		expect(await tickCoverAuto(db, { runSlot: run.fn })).toEqual({ roundId, status: 'queued' });
		expect(slots()[0].status).toBe('pending');
		expect(await tickCoverAuto(db, { runSlot: run.fn })).toEqual({ roundId, status: 'done' });
	});

	it('a runSlot throw fails the job without crashing the tick', async () => {
		enqueueCoverAuto(db, roundId);
		const boom = (async () => { throw new Error('boom'); }) as unknown as NonNullable<TickDeps['runSlot']>;
		expect(await tickCoverAuto(db, { runSlot: boom })).toEqual({ roundId, status: 'failed' });
		expect(getAutoJob(db, roundId)!.status).toBe('failed');
	});
});

describe('publishCoverAutoAlert', () => {
	it('posts to the mlb-alert topic without touching the avatar topic default', async () => {
		const posts: { url: string; body: { topic: string } }[] = [];
		const fetchImpl = (async (u: string | URL, init?: RequestInit) => {
			posts.push({ url: String(u), body: JSON.parse(String(init?.body)) });
			return new Response('{}', { status: 200 });
		}) as never;
		const env = { NTFY_URL: 'https://ntfy.example/', NTFY_TOKEN: 't', AVATAR_FACTORY_HIL_TOPIC: 'avatar-hil' };
		expect(await publishCoverAutoAlert({ title: 'a', message: 'b' }, { env, fetchImpl })).toBe(true);
		expect(posts).toEqual([{ url: 'https://ntfy.example', body: expect.objectContaining({ topic: COVER_AUTO_TOPIC }) }]);
		expect(env.AVATAR_FACTORY_HIL_TOPIC).toBe('avatar-hil');
	});
});

describe('approve / deny routes', () => {
	const call = (h: (e: never) => unknown, token: string, auth?: string) =>
		h({ request: new Request('http://x/api', { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify({ token }) }) } as never) as Promise<Response>;
	async function parked(): Promise<string> {
		enqueueCoverAuto(db, roundId);
		await tickCoverAuto(db, { runSlot: fakeRun({ Linoleum: 'needs_approval' }).fn, notify: async () => true });
		return getAutoJob(db, roundId)!.hil_token!;
	}

	it('approve: wrong bearer → 401 and nothing changes; right bearer → cap 2 + queued', async () => {
		const token = await parked();
		expect((await call(APPROVE, token, 'Bearer nope')).status).toBe(401);
		expect((await call(APPROVE, token)).status).toBe(401);
		expect(getAutoJob(db, roundId)!.status).toBe('awaiting_approval');
		const res = await call(APPROVE, token, 'Bearer secret');
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, status: 'queued' });
		expect(getAutoJob(db, roundId)).toMatchObject({ status: 'queued', cap_usd: 2 });
		expect((await call(APPROVE, token, 'Bearer secret')).status).toBe(400);
	});

	it('deny: remaining slots failed "budget not approved", job done', async () => {
		const token = await parked();
		expect((await call(DENY, token, 'Bearer nope')).status).toBe(401);
		const res = await call(DENY, token, 'Bearer secret');
		expect(res.status).toBe(200);
		expect(getAutoJob(db, roundId)!.status).toBe('done');
		expect(slots().filter((s) => s.status === 'failed').map((s) => s.note)).toEqual([BUDGET_DENIED_NOTE, BUDGET_DENIED_NOTE]);
	});
});

describe('run-auto action', () => {
	it('enqueues for an ON league (retrying failed slots) and refuses an OFF league', async () => {
		const r = (await runAction(db, { action: 'run-auto', roundId })) as { job: { status: string } };
		expect(r.job.status).toBe('queued');
		expect(slots()).toHaveLength(3);
		db.prepare(`UPDATE cover_podium_slots SET status = 'failed' WHERE title = 'Third'`).run();
		db.prepare(`UPDATE cover_auto_jobs SET status = 'done'`).run();
		await runAction(db, { action: 'run-auto', roundId });
		expect(slots().find((s) => s.title === 'Third')!.status).toBe('pending');
		expect(getAutoJob(db, roundId)!.status).toBe('queued');
		await expect(runAction(db, { action: 'run-auto', roundId: offRoundId })).rejects.toMatchObject({ status: 400 });
		expect(slots(offRoundId)).toEqual([]);
	});
});

describe('startCoverAutoRunner', () => {
	it('polls on COVER_AUTO_POLL_MS with an unref()d timer', async () => {
		vi.useFakeTimers();
		process.env.COVER_AUTO_POLL_MS = '5000';
		const unref = vi.spyOn(globalThis, 'setInterval');
		startCoverAutoRunner();
		expect(unref.mock.calls[0][1]).toBe(5000);
		const t = unref.mock.results[0].value as { hasRef?: () => boolean };
		expect(t.hasRef?.()).toBe(false);
		delete process.env.COVER_AUTO_POLL_MS;
	});
});
