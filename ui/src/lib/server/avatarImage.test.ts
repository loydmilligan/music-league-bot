import { it, expect, describe, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel, type AiModelInsert } from '$lib/db/aiModels.js';
import { modelForAvatar } from './avatarImage.js';

const db = openLeagueDb(':memory:');
function mk(modelId: string, over: Partial<AiModelInsert> = {}) {
	return insertModel(db, {
		model_id: modelId, nickname: null, description: null, model_type: null,
		context_len: null, price_in: null, price_out: null, is_free: 0, cost_override: null,
		cap_reason: 0, cap_stream: 1, cap_vision: 0, cap_tools: 0, cap_json: 1,
		favorite: 0, sort_order: 0, ...over,
	});
}
beforeEach(() => {
	db.prepare('DELETE FROM ai_models').run();
	db.prepare("DELETE FROM settings WHERE key = 'avatar_image_model'").run();
});

describe('modelForAvatar', () => {
	it('auto-picks a kinds=image model with general model_type (favorite first)', () => {
		mk('a/legacy', { model_type: 'image' });
		mk('b/kinds', { model_type: 'general', kinds: '["image"]', favorite: 1 });
		expect(modelForAvatar(db)).toBe('b/kinds');
	});
	it('settings override wins', () => {
		mk('b/kinds', { model_type: 'general', kinds: '["image"]', favorite: 1 });
		db.prepare("INSERT INTO settings (key, value) VALUES ('avatar_image_model', 'x/override')").run();
		expect(modelForAvatar(db)).toBe('x/override');
	});
});
