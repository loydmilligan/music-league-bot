import { describe, it, expect } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { storylinesSectionEnabledFor, setStorylinesSectionEnabled } from './storylinesSection.js';
import { randomUUID } from 'node:crypto';

describe('storylines opt-in', () => {
	it('defaults off and round-trips the setting', () => {
		const db = openLeagueDb(`/tmp/s-${randomUUID()}.db`);
		expect(storylinesSectionEnabledFor(db, 'sssc')).toBe(false);
		setStorylinesSectionEnabled(db, 'sssc', true);
		expect(storylinesSectionEnabledFor(db, 'sssc')).toBe(true);
	});
});
