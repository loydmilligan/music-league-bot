import { describe, expect, it } from 'vitest';
import { boxFromDrag, boxPhrase, nextLetter } from './markup';

describe('nextLetter', () => {
	it('returns the first unused letter label', () => {
		expect(nextLetter([])).toBe('A');
		expect(nextLetter(['A', 'B', 'D'])).toBe('C');
		expect(nextLetter(['Person 1', 'A'])).toBe('B');
	});
	it('rolls past Z to AA', () => {
		const all = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
		expect(nextLetter(all)).toBe('AA');
	});
});

describe('boxFromDrag', () => {
	it('builds a box from any drag direction, clamped to the frame', () => {
		expect(boxFromDrag({ x: 0.6, y: 0.9 }, { x: 0.1, y: 0.2 })).toEqual([0.1, 0.2, 0.5, 0.7]);
		expect(boxFromDrag({ x: -0.2, y: 0.5 }, { x: 0.3, y: 1.4 })).toEqual([0, 0.5, 0.3, 0.5]);
	});
	it('never lets x+w or y+h exceed 1 after rounding', () => {
		const b = boxFromDrag({ x: 0.33333, y: 0.66666 }, { x: 1, y: 1 })!;
		expect(b[0] + b[2]).toBeLessThanOrEqual(1);
		expect(b[1] + b[3]).toBeLessThanOrEqual(1);
	});
	it('ignores drags under 2% on either side', () => {
		expect(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.9 })).toBeNull();
		expect(boxFromDrag({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.515 })).toBeNull();
	});
});

describe('boxPhrase', () => {
	it('names the region and the percent span', () => {
		expect(boxPhrase([0.1, 0.2, 0.35, 0.7])).toBe('left-center, x 10–45%, y 20–90%');
		expect(boxPhrase([0.4, 0.4, 0.2, 0.2])).toBe('center, x 40–60%, y 40–60%');
		expect(boxPhrase([0.7, 0.05, 0.25, 0.2])).toBe('right-top, x 70–95%, y 5–25%');
	});
});
