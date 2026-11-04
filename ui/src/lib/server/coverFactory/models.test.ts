import { it, expect, describe, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel, type AiModelInsert } from '$lib/db/aiModels.js';
import { COVER_JOB_KEYS, getPinnedCoverModel } from './models.js';

const db = openLeagueDb(':memory:');

function mk(modelId: string, over: Partial<AiModelInsert> = {}) {
	return insertModel(db, {
		model_id: modelId, nickname: null, description: null, model_type: null,
		context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null,
		cap_reason: 0, cap_stream: 1, cap_vision: 0, cap_tools: 0, cap_json: 1,
		favorite: 0, sort_order: 0, ...over,
	});
}
const pin = (job: keyof typeof COVER_JOB_KEYS, v: string) =>
	db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(COVER_JOB_KEYS[job], v);

beforeEach(() => {
	db.prepare('DELETE FROM ai_models').run();
	db.prepare("DELETE FROM settings WHERE key LIKE 'cover_factory_%'").run();
});

describe('getPinnedCoverModel', () => {
	it('uses the exact settings keys', () => {
		expect(COVER_JOB_KEYS).toEqual({
			reader: 'cover_factory_reader_model',
			generator: 'cover_factory_generator_model',
			pitch: 'cover_factory_pitch_model',
		});
	});
	it('returns the pinned id when present', () => {
		mk('g/fav', { kinds: '["image"]', favorite: 1 });
		mk('g/pinned', { kinds: '["image"]' });
		pin('generator', 'g/pinned');
		expect(getPinnedCoverModel(db, 'generator')).toBe('g/pinned');
	});
	it('falls back to the favorite generator when the pinned row is deleted', () => {
		mk('g/fav', { kinds: '["image"]', favorite: 1 });
		mk('g/other', { kinds: '["image"]' });
		pin('generator', 'g/gone');
		expect(getPinnedCoverModel(db, 'generator')).toBe('g/fav');
	});
	it('treats a pinned model that no longer fits the job as missing', () => {
		mk('g/fav', { kinds: '["image"]', favorite: 1 });
		mk('t/text', { kinds: '["text"]' });
		pin('generator', 't/text');
		expect(getPinnedCoverModel(db, 'generator')).toBe('g/fav');
	});
	it('returns null with an empty roster', () => {
		pin('generator', 'g/gone');
		expect(getPinnedCoverModel(db, 'generator')).toBeNull();
		expect(getPinnedCoverModel(db, 'reader')).toBeNull();
	});
});
