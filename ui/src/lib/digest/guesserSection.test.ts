import { describe, it, expect } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { guesserSectionEnabledFor, setGuesserSectionEnabled } from './guesserSection.js';
import { randomUUID } from 'node:crypto';

describe('guesser opt-in', () => {
	it('defaults off and round-trips the setting', () => {
		const db = openLeagueDb(`/tmp/g-${randomUUID()}.db`);
		expect(guesserSectionEnabledFor(db, 'sssc')).toBe(false);
		setGuesserSectionEnabled(db, 'sssc', true);
		expect(guesserSectionEnabledFor(db, 'sssc')).toBe(true);
	});
});
