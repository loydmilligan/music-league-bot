import { describe, expect, it } from 'vitest';
import { isGenerationPaused, PAUSED_MESSAGE } from './pause.js';

describe('OpenRouter generation pause', () => {
	it('defaults to enabled; kill switch is 1 or true', () => {
		expect(isGenerationPaused({})).toBe(false);
		expect(isGenerationPaused({ AVATAR_FACTORY_OPENROUTER_PAUSED: '0' })).toBe(false);
		expect(isGenerationPaused({ AVATAR_FACTORY_OPENROUTER_PAUSED: '' })).toBe(false);
		expect(isGenerationPaused({ AVATAR_FACTORY_OPENROUTER_PAUSED: '1' })).toBe(true);
		expect(isGenerationPaused({ AVATAR_FACTORY_OPENROUTER_PAUSED: 'true' })).toBe(true);
		expect(isGenerationPaused({ AVATAR_FACTORY_OPENROUTER_PAUSED: 'TRUE' })).toBe(true);
		expect(isGenerationPaused({ AVATAR_FACTORY_GEN_PAUSED: '1' })).toBe(true);
		expect(isGenerationPaused({ AVATAR_FACTORY_GEN_PAUSED: 'true' })).toBe(true);
		expect(isGenerationPaused({ AVATAR_FACTORY_GEN_PAUSED: '0' })).toBe(false);
		expect(PAUSED_MESSAGE).toBe('OpenRouter image gen paused');
	});
});
