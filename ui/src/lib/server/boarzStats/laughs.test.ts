import { describe, it, expect } from 'vitest';
import { buildLaughTrack, isLaugh } from './laughs.js';

const comps = [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Cara' }];
const at = (min: number) => new Date(Date.UTC(2026, 9, 10, 20, min)).toISOString();

describe('buildLaughTrack', () => {
	it('detects laughs in text', () => {
		expect(isLaugh('hahaha')).toBe(true);
		expect(isLaugh('LMAO')).toBe(true);
		expect(isLaugh('dead 💀')).toBe(true);
		expect(isLaugh('😂')).toBe(true);
		expect(isLaugh('that was a hard lesson')).toBe(false);
		expect(isLaugh('Lolita')).toBe(false);
	});

	it('credits the joke, skips earlier laughs, never credits yourself, and ignores stale jokes', () => {
		const track = buildLaughTrack(
			[
				{ sender: 'Cara', text: 'an older message', ts: at(0) },
				{ sender: 'Alice', text: 'the joke', ts: at(20) },
				{ sender: 'Bob', text: 'hahaha', ts: at(21) },
				// Cara laughs after Bob's laugh: credit still goes to Alice's joke, not Bob.
				{ sender: 'Cara', text: '😂😂', ts: at(22) },
				// Alice laughing at her own joke credits nobody (Bob/Cara laughs are skipped, Alice is self).
				{ sender: 'Alice', text: 'lol', ts: at(23) },
				// 40 minutes later: outside the 10-minute window → given, but credits nobody.
				{ sender: 'Bob', text: 'lmao', ts: at(59) },
			],
			comps,
			(k) => k,
		);
		const by = Object.fromEntries(track.people.map((p) => [p.key, p]));
		expect(by.Alice).toMatchObject({ drawn: 2, given: 1 });
		expect(by.Bob).toMatchObject({ drawn: 0, given: 2 });
		expect(by.Cara).toMatchObject({ drawn: 0, given: 1 });
		expect(track.biggest).toMatchObject({ display: 'Alice', snippet: 'the joke', laughs: 2 });
		expect(track.textLaughs).toBe(4);
	});

	it('merges laugh reactions: reactor gives, author draws', () => {
		const track = buildLaughTrack([], comps, (k) => k, [
			{ reactorName: 'Bob', authorName: 'Alice', ts: at(1), snippet: null },
			{ reactorName: 'Alice', authorName: 'Alice', ts: at(2), snippet: null },
		]);
		const by = Object.fromEntries(track.people.map((p) => [p.key, p]));
		expect(by.Alice).toMatchObject({ drawn: 1, given: 1 });
		expect(by.Bob).toMatchObject({ drawn: 0, given: 1 });
		expect(track.reactionLaughs).toBe(2);
	});
});
