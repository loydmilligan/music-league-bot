import { describe, it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel } from '$lib/db/aiModels.js';
import { createProject } from './repo.js';
import { COVER_JOB_KEYS } from './models.js';
import { readCover, describeIdentity } from './reader.js';

const db = openLeagueDb(':memory:');
let pid = 0;
beforeEach(() => {
	db.exec('DELETE FROM cover_requests; DELETE FROM cover_versions; DELETE FROM cover_projects; DELETE FROM ai_models;');
	db.prepare("DELETE FROM settings WHERE key LIKE 'cover_factory_%'").run();
	insertModel(db, {
		model_id: 'google/gemini-2.5-flash', nickname: null, description: null, model_type: null, context_len: null,
		price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 1,
		cap_vision: 1, cap_tools: 0, cap_json: 1, favorite: 0, sort_order: 0,
	});
	db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(COVER_JOB_KEYS.reader, 'google/gemini-2.5-flash');
	pid = createProject(db, { title: 'T', source: 'upload', round_id: null, spotify_uri: null, league_slug: null, cover_rel: 'a.png', cover_url: null }).id;
});
const rows = () => db.prepare('SELECT * FROM cover_requests').all() as Record<string, unknown>[];
const okFetch = (content: string) => async () =>
	new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost: 0.002 } }), { status: 200 });

describe('readCover', () => {
	it('returns a Breakdown and logs ok', async () => {
		const b = await readCover(db, pid, 'data:image/png;base64,AA', {
			fetchImpl: okFetch('```json {"style":"s","subjects":[{"kind":"person","role":"main"}]}```'),
		});
		expect(b.style).toBe('s');
		expect(b.subjects[0].role).toBe('main');
		const r = rows();
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ step: 'read', outcome: 'ok', cost_usd: 0.002, model_id: 'google/gemini-2.5-flash' });
	});
	it('logs error on HTTP 402 and throws', async () => {
		const f = async () => new Response('{"error":{"message":"no credits"}}', { status: 402 });
		await expect(readCover(db, pid, 'data:x', { fetchImpl: f })).rejects.toThrow();
		expect(rows()[0]).toMatchObject({ step: 'read', outcome: 'error', error_reason: 'out_of_credits' });
	});
	it('logs error on unparseable output', async () => {
		await expect(readCover(db, pid, 'data:x', { fetchImpl: okFetch('nope') })).rejects.toThrow('unparseable');
		expect(rows()[0]).toMatchObject({ outcome: 'error', error_reason: 'unparseable' });
	});
	it('throws clearly with no reader model', async () => {
		db.exec('DELETE FROM ai_models');
		await expect(readCover(db, pid, 'data:x', { fetchImpl: okFetch('{}') })).rejects.toThrow(/reader model/);
	});
});

describe('describeIdentity', () => {
	it('returns trimmed text and logs identity step', async () => {
		const s = await describeIdentity(db, pid, 'data:x', { fetchImpl: okFetch('  Round face.  ') });
		expect(s).toBe('Round face.');
		expect(rows()[0]).toMatchObject({ step: 'identity', outcome: 'ok' });
	});
});
