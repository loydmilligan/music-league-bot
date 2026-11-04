import { describe, it, expect } from 'vitest';
import { normalizeBreakdown, parseModelJson } from './breakdown.js';

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
