import { describe, expect, it } from 'vitest';
import { isGenerationPaused, PAUSED_MESSAGE } from './pause.js';

describe('OpenRouter generation pause', () => {
	it('defaults to paused unless the flag is exactly 0', () => {
		expect(isGenerationPaused({})).toBe(true);
		expect(isGenerationPaused({ AVATAR_FACTORY_OPENROUTER_PAUSED: '1' })).toBe(true);
		expect(isGenerationPaused({ AVATAR_FACTORY_OPENROUTER_PAUSED: 'true' })).toBe(true);
		expect(isGenerationPaused({ AVATAR_FACTORY_OPENROUTER_PAUSED: '0' })).toBe(false);
		expect(PAUSED_MESSAGE).toBe('OpenRouter image gen paused');
	});
});
