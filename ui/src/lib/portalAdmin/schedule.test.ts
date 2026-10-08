import { describe, expect, it } from 'vitest';
import { nextDueAfter } from './schedule.js';

const NOW = Date.parse('2026-10-08T12:00:00Z');

describe('nextDueAfter', () => {
	it('returns null for manual and on-event frequencies', () => {
		expect(nextDueAfter('manual', '2026-10-08T11:00:00Z', NOW)).toBeNull();
		expect(nextDueAfter('on-event', '2026-10-08T11:00:00Z', NOW)).toBeNull();
	});

	it('returns null with no run history', () => {
		for (const f of ['hourly', 'daily', 'weekly'] as const) {
			expect(nextDueAfter(f, null, NOW)).toBeNull();
		}
	});

	it('steps past the current time by the frequency interval', () => {
		expect(nextDueAfter('hourly', new Date(NOW - 61 * 60_000).toISOString(), NOW)).toBe(new Date(NOW + 59 * 60_000).toISOString());
		expect(nextDueAfter('daily', new Date(NOW - 13 * 36e5).toISOString(), NOW)).toBe(
			new Date(NOW + 11 * 36e5).toISOString()
		);
		expect(nextDueAfter('weekly', new Date(NOW - 8 * 864e5).toISOString(), NOW)).toBe(
			new Date(NOW + 6 * 864e5).toISOString()
		);
	});

	it('treats an unparseable last-run as missing', () => {
		expect(nextDueAfter('daily', 'not-a-date', NOW)).toBeNull();
	});
});