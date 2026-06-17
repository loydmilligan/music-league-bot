import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel, getModelById } from '$lib/db/aiModels.js';

// Shared in-memory DB injected into the handler under test.
const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

let DELETE: typeof import('./+server.js').DELETE;

beforeEach(async () => {
	db.prepare('DELETE FROM ai_models').run();
	db.prepare("DELETE FROM settings WHERE key IN ('predict_model', 'digest_model')").run();
	({ DELETE } = await import('./+server.js'));
});

function mkModel(modelId: string): number {
	return insertModel(db, {
		model_id: modelId,
		nickname: null,
		description: null,
		model_type: null,
		context_len: null,
		price_in: null,
		price_out: null,
		is_free: 0,
		cost_override: null,
		cap_reason: 0,
		cap_stream: 1,
		cap_vision: 0,
		cap_tools: 0,
		cap_json: 1,
		favorite: 0,
		sort_order: 0,
	}).id;
}

function delEvt(id: number | string) {
	return { params: { id: String(id) } } as unknown as Parameters<typeof DELETE>[0];
}

const getSetting = (key: string) =>
	(db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;

describe('DELETE /api/models/:id', () => {
	it('removes the model and returns 204', async () => {
		const id = mkModel('anthropic/claude-sonnet-4.5');
		const res = await DELETE(delEvt(id));
		expect(res.status).toBe(204);
		expect(getModelById(db, id)).toBeNull();
	});

	it('clears a bucket override that pointed at the deleted model', async () => {
		const id = mkModel('anthropic/claude-sonnet-4.5');
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('predict_model', ?)").run('anthropic/claude-sonnet-4.5');
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('digest_model', ?)").run('anthropic/claude-sonnet-4.5');

		await DELETE(delEvt(id));

		expect(getSetting('predict_model')).toBeNull();
		expect(getSetting('digest_model')).toBeNull();
	});

	it('leaves bucket overrides that point at a different model untouched', async () => {
		const id = mkModel('anthropic/claude-sonnet-4.5');
		db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('predict_model', ?)").run('openai/gpt-4o');

		await DELETE(delEvt(id));

		expect(getSetting('predict_model')).toBe('openai/gpt-4o');
	});

	it('404s for an unknown id', async () => {
		await expect(DELETE(delEvt(99999))).rejects.toMatchObject({ status: 404 });
	});
});
