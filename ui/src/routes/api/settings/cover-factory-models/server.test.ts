import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel, type AiModelInsert } from '$lib/db/aiModels.js';

const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

let GET: typeof import('./+server.js').GET;
let PUT: typeof import('./+server.js').PUT;

beforeEach(async () => {
	db.prepare('DELETE FROM ai_models').run();
	db.prepare("DELETE FROM settings WHERE key LIKE 'cover_factory_%'").run();
	({ GET, PUT } = await import('./+server.js'));
});

function mk(modelId: string, over: Partial<AiModelInsert> = {}) {
	return insertModel(db, {
		model_id: modelId, nickname: null, description: null, model_type: null,
		context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null,
		cap_reason: 0, cap_stream: 1, cap_vision: 0, cap_tools: 0, cap_json: 1,
		favorite: 0, sort_order: 0, ...over,
	});
}
const put = (body: unknown) =>
	PUT({ request: new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) } as unknown as Parameters<typeof PUT>[0]);
const get = async () => (await GET({} as unknown as Parameters<typeof GET>[0])).json();

describe('cover-factory-models settings', () => {
	it('GET on empty settings returns all-null slots', async () => {
		expect(await get()).toEqual({
			reader: { pinned: null, missing: false, resolved: null },
			generator: { pinned: null, missing: false, resolved: null },
			pitch: { pinned: null, missing: false, resolved: null },
		});
	});

	it('PUT pins a fitting model; GET reflects it', async () => {
		mk('g/img', { kinds: '["image"]' });
		const res = await put({ job: 'generator', model_id: 'g/img' });
		expect(res.status).toBe(200);
		expect((await res.json()).generator).toEqual({ pinned: 'g/img', missing: false, resolved: 'g/img' });
	});

	it('pinned then deleted -> missing true with fallback resolved', async () => {
		const a = mk('g/pinned', { kinds: '["image"]' });
		mk('g/fallback', { kinds: '["image"]', favorite: 1 });
		await put({ job: 'generator', model_id: 'g/pinned' });
		db.prepare('DELETE FROM ai_models WHERE id = ?').run(a.id);
		expect((await get()).generator).toEqual({ pinned: 'g/pinned', missing: true, resolved: 'g/fallback' });
	});

	it('pinned then deleted with empty roster -> resolved null', async () => {
		const a = mk('g/pinned', { kinds: '["image"]' });
		await put({ job: 'generator', model_id: 'g/pinned' });
		db.prepare('DELETE FROM ai_models WHERE id = ?').run(a.id);
		expect((await get()).generator).toEqual({ pinned: 'g/pinned', missing: true, resolved: null });
	});

	it('rejects a text-only model for generator with 400', async () => {
		mk('t/text', { kinds: '["text"]' });
		await expect(put({ job: 'generator', model_id: 't/text' })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects model not in roster with 400', async () => {
		await expect(put({ job: 'pitch', model_id: 'nope/none' })).rejects.toMatchObject({ status: 400 });
	});

	it('rejects unknown job and non-string model_id with 400', async () => {
		await expect(put({ job: 'bogus', model_id: null })).rejects.toMatchObject({ status: 400 });
		await expect(put({ job: 'reader', model_id: 5 })).rejects.toMatchObject({ status: 400 });
		await expect(put({ job: 'reader' })).rejects.toMatchObject({ status: 400 });
	});

	it('null or empty clears the pin', async () => {
		mk('r/vis', { kinds: '["vision"]' });
		await put({ job: 'reader', model_id: 'r/vis' });
		expect((await get()).reader.pinned).toBe('r/vis');
		await put({ job: 'reader', model_id: null });
		expect((await get()).reader.pinned).toBeNull();
		await put({ job: 'reader', model_id: 'r/vis' });
		await put({ job: 'reader', model_id: '  ' });
		expect((await get()).reader.pinned).toBeNull();
	});
});
