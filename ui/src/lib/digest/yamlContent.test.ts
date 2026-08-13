import { describe, it, expect } from 'vitest';
import { toYaml, fromYaml, YAML_FIRST_KINDS } from './yamlContent';

/**
 * YAML is an editing mode over `content_json`, typed by hand in the review
 * screen. Two properties matter: a payload survives the round trip byte-for-
 * byte in meaning, and a half-typed document comes back as a diagnosable
 * `{ ok: false }` instead of an exception in the editor.
 */

// A real-shaped storylines payload: nested maps, lists of maps, unicode
// (⟨⟩ repair markers, ·), apostrophes, numbers, and empty values.
const STORYLINES = {
	title: 'Time for a Reinvention',
	cast: [
		{
			name: 'Conor',
			style: 'call-response',
			motif: 'minimum viable profundity',
			note: '',
			exchanges: [
				{ prompt: "Matt: well that was Conor's position", reply: 'Is' },
				{ prompt: 'asked to confirm he was whining about votes', reply: 'Correct' },
			],
		},
		{
			name: 'Mashew',
			style: 'edit-history',
			motif: 'apostrophe-optional',
			stats: [
				{ value: 12, label: 'dropped apostrophes' },
				{ value: 9, label: 'self-edits · all spelling' },
			],
			example: {
				repairs: [
					{ was: 'dont', now: "don't" },
					{ was: 'rememebr', now: 'remember' },
				],
				text: 'I ⟨dont⟩ ⟨rememebr⟩ being this wrong about someone',
				caption: 'one message, two edits · aug 5',
			},
			evidence: ['a line with "quotes" in it', 'a line: with a colon'],
			highlight: ['dont'],
		},
	],
};

describe('toYaml → fromYaml round trip', () => {
	it('round-trips a nested storylines payload unchanged', () => {
		const parsed = fromYaml(toYaml(STORYLINES));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value).toEqual(STORYLINES);
	});

	it('round-trips the phrase (Coinage) payload unchanged', () => {
		const phrase = {
			phrase: {
				style: 'dictionary',
				term: 'chopped unc',
				pronunciation: '/ˌtʃɒpt ˈʌŋk/',
				part_of_speech: 'noun · slang',
				definition:
					"An older man visibly straining to keep up with what's current — unc (out-of-touch uncle) + chopped (ugly, busted).",
				coined: { by: 'Steiny', on: '2026-08-09', at: 'Jensen, over an Outside Lands gif' },
				stats: { uses: 7, speakers: 4, prior_rounds: 0 },
				usages: [
					{ label: 'original', speaker: 'Steiny', text: '…feeling like a chopped unc what were…' },
					{ label: 'best', speaker: 'Shane', text: "I guess we're all chopped uncs" },
				],
				media: { src: '/_media/chopped-unc.gif', poster: '/_media/chopped-unc.jpg', caption: 'the gif that started it' },
				source: 'https://www.urbandictionary.com/define.php?term=chopped%20unc',
			},
		};
		const parsed = fromYaml(toYaml(phrase));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value).toEqual(phrase);
	});

	it('survives a second round trip byte-for-byte (idempotent serialisation)', () => {
		const once = toYaml(STORYLINES);
		const parsed = fromYaml(once);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(toYaml(parsed.value)).toBe(once);
	});

	it('preserves key order rather than sorting', () => {
		const yaml = toYaml({ zebra: 1, apple: 2, middle: 3 });
		expect(yaml.split('\n').filter(Boolean)).toEqual(['zebra: 1', 'apple: 2', 'middle: 3']);
	});

	it('serialises an empty/absent content object without throwing', () => {
		expect(() => toYaml(null)).not.toThrow();
		expect(() => toYaml(undefined)).not.toThrow();
		const parsed = fromYaml(toYaml({}));
		expect(parsed.ok).toBe(true);
	});

	it('preserves strings that look like other types', () => {
		const tricky = { a: 'yes', b: 'null', c: '12', d: '2026-08-09', e: '', f: 'no' };
		const parsed = fromYaml(toYaml(tricky));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value).toEqual(tricky);
	});
});

describe('fromYaml — never throws on garbage', () => {
	const garbage = [
		'',
		'   ',
		'\n\n\n',
		'{',
		'[',
		'a: "unterminated',
		"a: 'unterminated",
		'a:\n  b: 1\n c: 2',
		'- a\n- b',
		'just a bare scalar',
		'42',
		'true',
		'a: 1\na: 2',
		'\t\ta: 1',
		'*anchor',
		'a: [1, 2',
		'a: {b: 1',
		'??????',
		'\u0000\u0001\u0002',
		'cast:\n  - name: Conor\n   style: oops',
	];

	for (const src of garbage) {
		it(`does not throw on ${JSON.stringify(src)}`, () => {
			expect(() => fromYaml(src)).not.toThrow();
			const r = fromYaml(src);
			expect(r.ok).toBe(false);
			if (r.ok) return;
			expect(typeof r.error).toBe('string');
			expect(r.error.length).toBeGreaterThan(0);
		});
	}
});

describe('fromYaml — diagnosable errors', () => {
	it('reports a line number for an unterminated quote', () => {
		const r = fromYaml('title: Time for a Reinvention\ncast:\n  - name: "Conor\n');
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/[Ll]ine \d+/);
	});

	it('reports a line number for bad indentation', () => {
		const r = fromYaml('cast:\n  - name: Conor\n    style: call-response\n   motif: nope\n');
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/[Ll]ine \d+/);
	});

	it('keeps the error to a single line (no source excerpt in the editor banner)', () => {
		const r = fromYaml('a: "unterminated');
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).not.toContain('\n');
	});
});

describe('fromYaml — non-mapping documents are rejected', () => {
	it('rejects a bare list', () => {
		const r = fromYaml('- Conor\n- Mashew\n');
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/mapping/i);
		expect(r.error).toMatch(/list/i);
	});

	it('rejects a bare scalar', () => {
		const r = fromYaml('Time for a Reinvention');
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/mapping/i);
	});

	it('rejects an empty document', () => {
		const r = fromYaml('');
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/mapping/i);
	});

	// KNOWN FAILURE — owner: Miscellania (`yamlContent.ts`). `isMapping` is a
	// bare `typeof === 'object' && !Array.isArray` check, so a tagged binary
	// scalar slips the gate and comes back as `ok: true` holding a Uint8Array.
	// `fromYaml` promises a content mapping; a typed array is not one. Left red
	// deliberately until the gate rejects non-plain objects — do not weaken it.
	it('rejects a !!binary scalar — it is not a content mapping', () => {
		expect(() => fromYaml('!!binary not-really')).not.toThrow();
		const r = fromYaml('!!binary not-really');
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.error).toMatch(/mapping/i);
	});

	it('accepts a mapping whose values are lists', () => {
		const r = fromYaml('title: Time for a Reinvention\ncast:\n  - name: Conor\n');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value).toEqual({ title: 'Time for a Reinvention', cast: [{ name: 'Conor' }] });
	});
});

describe('YAML_FIRST_KINDS', () => {
	it('opens the two hand-authored section kinds in YAML mode', () => {
		expect(YAML_FIRST_KINDS.has('storylines')).toBe(true);
		expect(YAML_FIRST_KINDS.has('stats')).toBe(true);
		expect(YAML_FIRST_KINDS.has('quotes')).toBe(false);
	});
});
