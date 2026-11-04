import { describe, it, expect } from 'vitest';
import { normalizeBox, normalizeBreakdown, parseModelJson } from './breakdown.js';

describe('normalizeBreakdown', () => {
	it('handles live-observed shape', () => {
		const b = normalizeBreakdown({
			text_elements: [{ text: 'DWIGHT YOAKAM', position: 'left, vertical' }],
			subjects: [{ kind: 'person', role: 'hero' }],
		});
		expect(b.text_elements[0]).toBe('DWIGHT YOAKAM (left, vertical)');
		expect(b.subjects[0].role).toBe('secondary');
		expect(b.subjects[0].label).toBe('A');
		expect(b.no_subjects).toBe(false);
	});
	it('empty input', () => {
		const b = normalizeBreakdown({});
		expect(b).toMatchObject({ style: '', composition: '', palette_lighting: '', text_elements: [], subjects: [], no_subjects: true });
	});
	it('dedupes labels, defaults kind, objects-only means no_subjects', () => {
		const b = normalizeBreakdown({ subjects: [{ label: 'A', kind: 'robot' }, { label: 'A', kind: 'object' }] });
		expect(b.subjects.map((s) => s.label)).toEqual(['A', 'B']);
		expect(b.subjects[0].kind).toBe('object');
		expect(b.no_subjects).toBe(true);
	});
	it('stringifies odd text items', () => {
		expect(normalizeBreakdown({ text_elements: [{ x: 1 }] }).text_elements[0]).toBe('{"x":1}');
	});
});

describe('parseModelJson', () => {
	it('strips fences/prose', () => expect(parseModelJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 }));
	it('throws on none', () => expect(() => parseModelJson('no json')).toThrow('unparseable'));
});

describe('normalizeBox', () => {
	it('keeps valid fractions', () => expect(normalizeBox([0.1, 0.2, 0.3, 0.4])).toEqual([0.1, 0.2, 0.3, 0.4]));
	it('clamps overflow so x+w<=1', () => expect(normalizeBox([0.9, 0.9, 0.5, 0.5])).toEqual([0.9, 0.9, 0.1, 0.1]));
	it('converts pixels with size', () =>
		expect(normalizeBox([120, 40, 300, 500], { width: 600, height: 600 })).toEqual([0.2, 0.067, 0.5, 0.833]));
	it('rejects pixels without size', () => expect(normalizeBox([120, 40, 300, 500])).toBeUndefined());
	it('enforces minimum size', () => expect(normalizeBox([0.5, 0.5, 0, 0])).toEqual([0.5, 0.5, 0.02, 0.02]));
	it('rejects non-arrays', () => expect(normalizeBox('x')).toBeUndefined());
	it('normalizeBreakdown passes size through', () => {
		const b = normalizeBreakdown({ subjects: [{ label: 'A', kind: 'person', box: [60, 0, 300, 600] }] }, { width: 600, height: 600 });
		expect(b.subjects[0].box).toEqual([0.1, 0, 0.5, 1]);
	});
});
