import { describe, it, expect } from 'vitest';
import {
	REGULAR_STYLE_NAMES,
	TYPE_TO_STYLE,
	normalizeCast,
	resolveStyle,
	stylePayloadPresent,
	markRuns,
	splitRepairRuns,
	unquote,
	type RegularEntry,
	type RegularStyle,
	type Repair,
} from './regularStyles';

/**
 * The Regulars section is HAND-AUTHORED YAML in the review screen (no miner yet,
 * BACKLOG 0a). Every function here is therefore load-bearing for "a human typo
 * degrades, never crashes": a hydration crash on this section takes the whole
 * PNG export down. These tests pin that contract.
 *
 * Everything goes through `normalizeCast` where a real payload would, because
 * that is the only door into the component — the carrier never builds a
 * `RegularEntry` by hand.
 */

/** Build one entry the way the page does: raw YAML-ish object → normalizeCast. */
function one(raw: Record<string, unknown>): RegularEntry {
	const cast = normalizeCast({ cast: [{ name: 'Someone', ...raw }] });
	expect(cast).toHaveLength(1);
	return cast[0];
}

// The seven styles' minimum viable payloads, so a "present" case can be built
// for each without repeating the shapes in every test.
const PAYLOADS: Record<RegularStyle, Record<string, unknown>> = {
	'quote-led': { evidence: ['something they said'] },
	spotlight: { spotlight: { text: 'Is', caption: 'his entire answer' } },
	'call-response': { exchanges: [{ prompt: 'asked to confirm', reply: 'Correct' }] },
	'edit-history': {
		stats: [{ value: 12, label: 'dropped apostrophes' }],
		example: { repairs: [{ was: 'dont', now: "don't" }], text: 'I ⟨dont⟩ think so', caption: 'aug 5' },
	},
	'roster-map': { pairs: [{ real: 'Jensen', alias: 'Jenson' }] },
	refrain: { refrain: { token: 'lmao', caption: 'every round', occurrences: ['aug 5'], count: '+35' } },
	buzzer: { buzzer: { opens: '08:00', deadline: '20:00', marks: ['19:58'], caption: 'always' } },
};

describe('resolveStyle — priority chain', () => {
	it('an explicit valid style with its payload present wins over the type map', () => {
		// 'ritual opener' maps to refrain; the explicit spotlight must beat it.
		const e = one({ type: 'ritual opener', style: 'spotlight', ...PAYLOADS.spotlight });
		expect(TYPE_TO_STYLE['ritual opener']).toBe('refrain');
		expect(resolveStyle(e)).toBe('spotlight');
	});

	it('an unknown/garbage style: string falls back to the taxonomy type mapping', () => {
		const e = one({ type: 'nickname-minter', style: 'banana-split', ...PAYLOADS['roster-map'] });
		expect(resolveStyle(e)).toBe('roster-map');
	});

	it('neither style nor type present → quote-led', () => {
		expect(resolveStyle(one({ evidence: ['a quote'] }))).toBe('quote-led');
	});

	it('an unknown type with no style → quote-led', () => {
		expect(resolveStyle(one({ type: 'interpretive dancer' }))).toBe('quote-led');
	});

	it('maps every taxonomy type in TYPE_TO_STYLE when the payload is present', () => {
		for (const [type, style] of Object.entries(TYPE_TO_STYLE)) {
			const e = one({ type, ...PAYLOADS[style] });
			expect(resolveStyle(e), `type '${type}'`).toBe(style);
		}
	});

	it('matches type case- and whitespace-insensitively (via normalizeCast trimming)', () => {
		expect(resolveStyle(one({ type: '  Ritual Opener  ', ...PAYLOADS.refrain }))).toBe('refrain');
		expect(resolveStyle(one({ type: 'DEADLINE BRINKMAN', ...PAYLOADS.buzzer }))).toBe('buzzer');
		expect(resolveStyle(one({ type: '\tGhost\n', ...PAYLOADS.buzzer }))).toBe('buzzer');
	});

	// `resolveStyle` is exported, so it cannot lean on its caller having run
	// `normalizeCast` first — it has to trim `type` itself. These entries are
	// hand-built literals precisely to bypass the pipeline's coercion.
	it('trims and lowercases type itself, on an entry that never went through normalizeCast', () => {
		const handBuilt: RegularEntry = {
			name: 'Conor',
			motif: 'minimum viable profundity',
			type: '  One-Word Oracle  ',
			style: '' as RegularStyle,
			note: '',
			evidence: [],
			highlight: [],
			spotlight: { text: 'Is', caption: 'his entire answer' },
			exchanges: [],
			stats: [],
			example: null,
			summary: '',
			pairs: [],
			refrain: null,
			buzzer: null,
		};
		expect(resolveStyle(handBuilt)).toBe('spotlight');

		expect(resolveStyle({ ...handBuilt, type: '\tOne-Word Oracle\n' })).toBe('spotlight');
		expect(resolveStyle({ ...handBuilt, type: 'ONE-WORD ORACLE' })).toBe('spotlight');
		// Padding around a type that maps nowhere still resolves to the fallback.
		expect(resolveStyle({ ...handBuilt, type: '  interpretive dancer  ' })).toBe('quote-led');
	});
});

describe('resolveStyle — the safety net (declared style, missing payload)', () => {
	// This is the property that stops a half-written YAML block rendering an
	// empty card: declaring the style is not enough, the payload must be there.
	for (const style of REGULAR_STYLE_NAMES) {
		it(`style: ${style} with no ${style} payload degrades to quote-led`, () => {
			const e = one({ style, evidence: ['at least there is a quote'] });
			expect(resolveStyle(e)).toBe('quote-led');
			// quote-led is the only style that always has something to show.
			expect(stylePayloadPresent(e, style)).toBe(style === 'quote-led');
		});
	}

	it('degrades when the type map picks a style the entry cannot fill', () => {
		const e = one({ type: 'phonetic speller' }); // → roster-map, but no pairs
		expect(resolveStyle(e)).toBe('quote-led');
	});

	it('edit-history survives on stats alone, or on example alone', () => {
		expect(resolveStyle(one({ style: 'edit-history', stats: [{ value: 9, label: 'self-edits' }] }))).toBe(
			'edit-history',
		);
		expect(
			resolveStyle(one({ style: 'edit-history', example: { text: 'I ⟨dont⟩ know', repairs: [] } })),
		).toBe('edit-history');
	});

	it('an entry whose only payload is another style\'s degrades to quote-led', () => {
		const e = one({ style: 'buzzer', ...PAYLOADS.refrain });
		expect(resolveStyle(e)).toBe('quote-led');
	});
});

describe('normalizeCast — defensive coercion', () => {
	it('never throws and returns [] for junk at the top level', () => {
		for (const junk of [
			undefined,
			null,
			{},
			{ cast: null },
			{ cast: 'nope' },
			{ cast: 42 },
			{ cast: [null, 3, 'x'] },
			[],
			'a bare string',
			7,
		]) {
			expect(() => normalizeCast(junk)).not.toThrow();
			expect(normalizeCast(junk), JSON.stringify(junk ?? null)).toEqual([]);
		}
	});

	it("returns [] for the LLM's generic missing-kind fallback shape", () => {
		// The generic fallback is { title, body, items } — NOT { title, cast }.
		const content = { title: 'Time for a Reinvention', body: 'some prose', items: ['a', 'b'] };
		expect(normalizeCast(content)).toEqual([]);
	});

	it('drops entries without a name', () => {
		const cast = normalizeCast({
			cast: [
				{ name: 'Conor', motif: 'minimum viable profundity' },
				{ motif: 'nameless' },
				{ name: '   ', motif: 'whitespace-only' },
				{ name: 'Mashew' },
			],
		});
		expect(cast.map((e) => e.name)).toEqual(['Conor', 'Mashew']);
	});

	it('coerces numbers to strings in stats[].value', () => {
		const e = one({ stats: [{ value: 12, label: 'dropped apostrophes' }] });
		expect(e.stats).toEqual([{ value: '12', label: 'dropped apostrophes' }]);
	});

	it('filters partial repairs (missing now, missing was)', () => {
		const e = one({
			example: {
				repairs: [
					{ was: 'dont', now: "don't" },
					{ was: 'rememebr' }, // no now
					{ now: 'remember' }, // no was
					'not even an object',
					null,
				],
				text: 'I ⟨dont⟩ ⟨rememebr⟩ being this wrong',
				caption: 'one message, two edits · aug 5',
			},
		});
		expect(e.example?.repairs).toEqual([{ was: 'dont', now: "don't" }]);
	});

	it('filters partial pairs (missing alias or real)', () => {
		const e = one({
			pairs: [
				{ real: 'Jensen', alias: 'Jenson' },
				{ real: 'Paletz' }, // no alias
				{ alias: 'Steiny' }, // no real
				42,
			],
		});
		expect(e.pairs).toEqual([{ real: 'Jensen', alias: 'Jenson' }]);
	});

	it('filters exchanges with no reply, keeping prompt-less ones', () => {
		const e = one({
			exchanges: [
				{ prompt: 'Matt: well that was Conor\'s position', reply: 'Is' },
				{ prompt: 'a question nobody answered' }, // no reply → dropped
				{ reply: 'Correct' }, // prompt optional
			],
		});
		expect(e.exchanges).toEqual([
			{ prompt: "Matt: well that was Conor's position", reply: 'Is' },
			{ prompt: '', reply: 'Correct' },
		]);
	});

	it('nulls out style payloads that carry nothing', () => {
		const e = one({
			spotlight: { caption: 'no text' },
			refrain: { caption: 'no token', occurrences: ['aug 5'] },
			buzzer: { opens: '08:00', deadline: '20:00', marks: [] },
			example: { repairs: [], text: '' },
		});
		expect(e.spotlight).toBeNull();
		expect(e.refrain).toBeNull();
		expect(e.buzzer).toBeNull();
		expect(e.example).toBeNull();
	});

	// Every storylines row written before this redesign carries `headline` and no
	// `note`. Reading only `note` silently deleted their prose from drafts that
	// were already generated (and, for R147, already awaiting the owner's
	// sign-off). The paragraph is gone from the *new* design by intent — it must
	// not vanish from *old* rows by accident.
	it('falls back to headline when a pre-redesign row has no note', () => {
		const e = one({ headline: 'Types faster than his own punctuation' });
		expect(e.note).toBe('Types faster than his own punctuation');
	});

	it('uses note when only note is present', () => {
		const e = one({ note: 'answers in one word, every time' });
		expect(e.note).toBe('answers in one word, every time');
	});

	it('prefers note over headline when both are present', () => {
		const e = one({
			note: 'answers in one word, every time',
			headline: 'Types faster than his own punctuation',
		});
		expect(e.note).toBe('answers in one word, every time');
		expect(e.note).not.toContain('punctuation');
	});

	it('falls through an empty or whitespace-only headline to an empty string', () => {
		expect(one({ headline: '' }).note).toBe('');
		expect(one({ headline: '   ' }).note).toBe('');
		expect(one({ note: '  ', headline: '\t\n' }).note).toBe('');
		// An empty note with a real headline still gets the headline.
		expect(one({ note: '   ', headline: 'Types faster than his own punctuation' }).note).toBe(
			'Types faster than his own punctuation',
		);
	});

	it('normalises a real pre-redesign storylines row intact', () => {
		// Shape lifted from an actual `digest_sections.content_json` row: name +
		// headline + evidence[], sometimes a motif, never a style or a type.
		const cast = normalizeCast({
			title: 'Cast and Motifs',
			cast: [
				{
					name: 'PoetryinNoise',
					headline: "Sir Mix-a-Lot's Biggest Fan (And Reluctant Motley Crüe Scholar)",
					evidence: [
						'"Look, I\'m not saying I prefer my paramours to have a big ol\' butt...but few songs have spoken to me on a deeper level than Baby\'s Got Back."',
						"Confessed to owning Motley Crüe's *New Tattoo* twice and experiencing active moral distress about it.",
					],
				},
				{
					name: 'KarBen',
					motif: 'extensions & peace and love',
					headline: 'Patron Saint of the Last-Minute Extension',
					evidence: ['3 hours left to vote. No worries at all if you cant make it in time'],
				},
			],
		});

		expect(cast).toHaveLength(2);

		const poetry = cast[0];
		expect(poetry.name).toBe('PoetryinNoise');
		expect(poetry.note).toBe("Sir Mix-a-Lot's Biggest Fan (And Reluctant Motley Crüe Scholar)");
		expect(poetry.evidence).toHaveLength(2);
		// The wrapping quote marks come off; the interior apostrophes do not.
		expect(poetry.evidence[0]).toBe(
			"Look, I'm not saying I prefer my paramours to have a big ol' butt...but few songs have spoken to me on a deeper level than Baby's Got Back.",
		);
		// No style, no type — the safe fallback, with its paragraph intact.
		expect(poetry.style).toBe('');
		expect(poetry.type).toBe('');
		expect(resolveStyle(poetry)).toBe('quote-led');

		const karben = cast[1];
		expect(karben.motif).toBe('extensions & peace and love');
		expect(karben.note).toBe('Patron Saint of the Last-Minute Extension');
		expect(resolveStyle(karben)).toBe('quote-led');
	});

	it('strips one wrapping quote pair off each evidence line', () => {
		const e = one({ evidence: ['"already quoted"', 'bare line', '', 7] });
		expect(e.evidence).toEqual(['already quoted', 'bare line', '7']);
	});
});

describe('normalizeCast — a full valid entry round-trips per style', () => {
	it('quote-led', () => {
		const e = one({
			name: 'Grant',
			type: 'catchphrase-holder',
			motif: 'never not leaving',
			note: 'threatens retirement, stays',
			evidence: ['this is my last round', 'ok one more round'],
			highlight: ['last round'],
		});
		expect(resolveStyle(e)).toBe('quote-led');
		expect(e.note).toBe('threatens retirement, stays');
		expect(e.evidence).toEqual(['this is my last round', 'ok one more round']);
		expect(e.highlight).toEqual(['last round']);
	});

	it('spotlight', () => {
		const e = one({
			name: 'Conor',
			style: 'spotlight',
			motif: 'minimum viable profundity',
			spotlight: { text: 'Is', caption: 'his entire contribution to the thread' },
			evidence: ['Is'],
		});
		expect(resolveStyle(e)).toBe('spotlight');
		expect(e.spotlight).toEqual({ text: 'Is', caption: 'his entire contribution to the thread' });
	});

	it('call-response (HANDOFF §7 example)', () => {
		const e = one({
			name: 'Conor',
			style: 'call-response',
			motif: 'minimum viable profundity',
			exchanges: [
				{ prompt: "Matt: well that was Conor's position", reply: 'Is' },
				{ prompt: 'asked to confirm he was whining about votes', reply: 'Correct' },
			],
		});
		expect(resolveStyle(e)).toBe('call-response');
		expect(e.name).toBe('Conor');
		expect(e.motif).toBe('minimum viable profundity');
		expect(e.exchanges).toEqual([
			{ prompt: "Matt: well that was Conor's position", reply: 'Is' },
			{ prompt: 'asked to confirm he was whining about votes', reply: 'Correct' },
		]);
	});

	it('edit-history (HANDOFF §7 example)', () => {
		const e = one({
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
		});
		expect(resolveStyle(e)).toBe('edit-history');
		expect(e.stats).toEqual([
			{ value: '12', label: 'dropped apostrophes' },
			{ value: '9', label: 'self-edits · all spelling' },
		]);
		expect(e.example).toEqual({
			repairs: [
				{ was: 'dont', now: "don't" },
				{ was: 'rememebr', now: 'remember' },
			],
			text: 'I ⟨dont⟩ ⟨rememebr⟩ being this wrong about someone',
			caption: 'one message, two edits · aug 5',
		});
	});

	it('roster-map', () => {
		const e = one({
			name: 'Steiny',
			style: 'roster-map',
			motif: 'everyone gets renamed',
			summary: 'four regulars, four new names',
			pairs: [
				{ real: 'Jensen', alias: 'Jenson' },
				{ real: 'Paletz', alias: 'Peletz' },
			],
		});
		expect(resolveStyle(e)).toBe('roster-map');
		expect(e.summary).toBe('four regulars, four new names');
		expect(e.pairs).toEqual([
			{ real: 'Jensen', alias: 'Jenson' },
			{ real: 'Paletz', alias: 'Peletz' },
		]);
	});

	it('refrain', () => {
		const e = one({
			name: 'Grant',
			style: 'refrain',
			motif: 'the same three letters',
			refrain: {
				token: 'lol',
				caption: 'opens every message this way',
				occurrences: ['aug 3', 'aug 5', 'aug 9'],
				count: '+35',
			},
		});
		expect(resolveStyle(e)).toBe('refrain');
		expect(e.refrain).toEqual({
			token: 'lol',
			caption: 'opens every message this way',
			occurrences: ['aug 3', 'aug 5', 'aug 9'],
			count: '+35',
		});
	});

	it('buzzer', () => {
		const e = one({
			name: 'Paletz',
			style: 'buzzer',
			motif: 'submits at the horn',
			buzzer: {
				opens: '08:00',
				deadline: '20:00',
				marks: ['19:41', '19:58', '19:59'],
				caption: 'three rounds, three photo finishes',
			},
		});
		expect(resolveStyle(e)).toBe('buzzer');
		expect(e.buzzer).toEqual({
			opens: '08:00',
			deadline: '20:00',
			marks: ['19:41', '19:58', '19:59'],
			caption: 'three rounds, three photo finishes',
		});
	});
});

describe('markRuns', () => {
	const concat = (runs: { t: string }[]) => runs.map((r) => r.t).join('');

	it('marks whole words, case-insensitively', () => {
		const runs = markRuns('Chopped unc, chopped UNC everywhere', ['unc']);
		expect(runs.filter((r) => r.hit).map((r) => r.t)).toEqual(['unc', 'UNC']);
	});

	it('does not mark a token inside a larger word', () => {
		const runs = markRuns('uncle uncut unc', ['unc']);
		expect(runs.filter((r) => r.hit)).toHaveLength(1);
		expect(runs.filter((r) => r.hit)[0].t).toBe('unc');
	});

	it('escapes regex metacharacters in tokens', () => {
		// A token 'a.b' must match literally, never 'axb'.
		const runs = markRuns('axb and a.b', ['a.b']);
		expect(runs.filter((r) => r.hit).map((r) => r.t)).toEqual(['a.b']);
	});

	it('does not let a token like (x|y) act as alternation', () => {
		const runs = markRuns('x y (x|y)', ['(x|y)']);
		expect(runs.some((r) => r.hit && r.t === 'x')).toBe(false);
		expect(concat(runs)).toBe('x y (x|y)');
	});

	it('returns the whole string as one unmarked run for an empty token list', () => {
		expect(markRuns('nothing to mark', [])).toEqual([{ t: 'nothing to mark', hit: false }]);
		// Whitespace-only tokens are the same as none.
		expect(markRuns('nothing to mark', ['', '   '])).toEqual([{ t: 'nothing to mark', hit: false }]);
	});

	it('handles multiple tokens and adjacent matches', () => {
		const runs = markRuns('dont rememebr', ['dont', 'rememebr']);
		expect(runs.map((r) => [r.t, r.hit])).toEqual([
			['dont', true],
			[' ', false],
			['rememebr', true],
		]);
	});

	it('PROPERTY: the concatenation of all runs always equals the input exactly', () => {
		const cases: [string, string[]][] = [
			['', ['unc']],
			['no match here', ['zzz']],
			['unc', ['unc']],
			['unc at the start', ['unc']],
			['ends with unc', ['unc']],
			['unc unc unc', ['unc']],
			['I ⟨dont⟩ rememebr being this wrong', ['dont', 'rememebr']],
			['punctuation, unc! and "unc"?', ['unc']],
			['emoji 🐾 unc 🐾', ['unc']],
			['multi\nline unc\ttext', ['unc']],
			['overlap: chopped unc', ['unc', 'chopped unc']],
			['case UNC Unc unc', ['UnC']],
			['nothing at all', []],
		];
		for (const [text, tokens] of cases) {
			expect(concat(markRuns(text, tokens)), JSON.stringify(text)).toBe(text);
		}
	});
});

describe('splitRepairRuns', () => {
	const repairs: Repair[] = [
		{ was: 'dont', now: "don't" },
		{ was: 'rememebr', now: 'remember' },
	];

	it('maps ⟨angle-bracket⟩ tokens to their Repair', () => {
		const runs = splitRepairRuns('I ⟨dont⟩ ⟨rememebr⟩ being this wrong', repairs);
		expect(runs.filter((r) => r.repair).map((r) => r.repair!.now)).toEqual(["don't", 'remember']);
		expect(runs.map((r) => r.t)).toEqual(['I ', 'dont', ' ', 'rememebr', ' being this wrong']);
	});

	it('matches the repair case-insensitively', () => {
		const runs = splitRepairRuns('⟨DONT⟩', repairs);
		expect(runs[0].repair).toEqual({ was: 'dont', now: "don't" });
	});

	it('yields repair: null for an unmatched ⟨token⟩ but still shows the text', () => {
		const runs = splitRepairRuns('I ⟨wat⟩ know', repairs);
		expect(runs.find((r) => r.t === 'wat')?.repair).toBeNull();
		expect(runs.map((r) => r.t).join('')).toBe('I wat know');
	});

	// Padding inside the brackets used to be trimmed away, so `I ⟨ dont ⟩ know`
	// rendered as `I dont know`. The spaces are now their own plain runs: the
	// strike-through covers the word only, and the lookup still trims.
	it('keeps padding inside the brackets as plain text, and still matches the repair', () => {
		const runs = splitRepairRuns('I ⟨ dont ⟩ know', repairs);
		expect(runs.map((r) => r.t).join('')).toBe('I  dont  know');
		const struck = runs.filter((r) => r.repair);
		expect(struck.map((r) => r.t)).toEqual(['dont']);
		expect(struck[0].repair).toEqual({ was: 'dont', now: "don't" });
		// The padding itself is never struck through.
		expect(runs.filter((r) => r.t.trim() === '').every((r) => r.repair === null)).toBe(true);
	});

	it('handles padding on one side only, and multi-space padding', () => {
		expect(splitRepairRuns('I ⟨dont ⟩ know', repairs).map((r) => r.t).join('')).toBe('I dont  know');
		expect(splitRepairRuns('I ⟨ dont⟩ know', repairs).map((r) => r.t).join('')).toBe('I  dont know');
		// One space outside the bracket + three inside = four on each side.
		expect(splitRepairRuns('I ⟨   dont   ⟩ know', repairs).map((r) => r.t).join('')).toBe(
			'I    dont    know',
		);
		// Still one struck run in each case.
		for (const text of ['I ⟨dont ⟩ know', 'I ⟨ dont⟩ know', 'I ⟨   dont   ⟩ know']) {
			expect(splitRepairRuns(text, repairs).filter((r) => r.repair).map((r) => r.t)).toEqual(['dont']);
		}
	});

	// Authoring syntax must never reach the rendered digest. A bare `⟨⟩` produces
	// no runs, and the raw-text fallback would have leaked the brackets.
	it('renders a bare ⟨⟩ as nothing, not as the brackets themselves', () => {
		const runs = splitRepairRuns('⟨⟩', []);
		expect(runs).toEqual([{ t: '', repair: null }]);
		expect(runs.map((r) => r.t).join('')).not.toMatch(/[⟨⟩]/);
	});

	it('keeps whitespace from a ⟨  ⟩ marker but not the brackets', () => {
		const runs = splitRepairRuns('⟨  ⟩', repairs);
		expect(runs.map((r) => r.t).join('')).toBe('  ');
		expect(runs.every((r) => r.repair === null)).toBe(true);
		expect(runs.map((r) => r.t).join('')).not.toMatch(/[⟨⟩]/);
	});

	it('drops an empty marker from the middle of a sentence', () => {
		const runs = splitRepairRuns('I ⟨⟩ know', repairs);
		expect(runs.map((r) => r.t).join('')).toBe('I  know');
		expect(runs.some((r) => r.repair)).toBe(false);
		expect(runs.map((r) => r.t).join('')).not.toMatch(/[⟨⟩]/);
	});

	it('still returns unmarked text verbatim (the fallback that should not change)', () => {
		expect(splitRepairRuns('one message, two edits', repairs)).toEqual([
			{ t: 'one message, two edits', repair: null },
		]);
		expect(splitRepairRuns('', repairs)).toEqual([{ t: '', repair: null }]);
		expect(splitRepairRuns('   ', repairs)).toEqual([{ t: '   ', repair: null }]);
	});

	it('returns one run for text with no brackets', () => {
		expect(splitRepairRuns('nothing marked here', repairs)).toEqual([
			{ t: 'nothing marked here', repair: null },
		]);
	});

	it('returns one run for empty text and for empty repairs', () => {
		expect(splitRepairRuns('', [])).toEqual([{ t: '', repair: null }]);
		expect(splitRepairRuns('plain', [])).toEqual([{ t: 'plain', repair: null }]);
	});

	it('PROPERTY: concatenating runs reproduces the input minus the bracket characters', () => {
		const cases = [
			'',
			'no brackets',
			'⟨dont⟩',
			'⟨dont⟩ at the start',
			'ends with ⟨rememebr⟩',
			'⟨dont⟩⟨rememebr⟩ back to back',
			'I ⟨dont⟩ ⟨rememebr⟩ being this wrong about someone',
			'an ⟨unmatched⟩ token',
			'an ⟨⟩ empty token',
			'multi\nline ⟨dont⟩ text',
			// Padded tokens — the case the property did not previously hold for.
			'I ⟨ dont ⟩ know',
			'⟨ dont ⟩ at the start',
			'ends with ⟨ rememebr ⟩',
			'⟨ dont ⟩⟨ rememebr ⟩ back to back',
			'an ⟨ unmatched ⟩ token',
			'multi\nline ⟨\tdont\t⟩ text',
			'⟨  ⟩ padding only',
			// Empty markers: nothing to show, and nothing left behind.
			'⟨⟩',
			'I ⟨⟩ know',
			'⟨⟩⟨⟩',
			'⟨⟩ leading',
			'trailing ⟨⟩',
		];
		for (const text of cases) {
			const runs = splitRepairRuns(text, repairs);
			expect(runs.map((r) => r.t).join(''), JSON.stringify(text)).toBe(text.replace(/[⟨⟩]/g, ''));
		}
	});

	// The general invariant, stronger than any single case: authoring syntax
	// never survives into the rendered runs. The one exception is an unclosed
	// `⟨` — the regex can't pair it, so it stays as literal text rather than
	// silently eating the rest of the line.
	it('PROPERTY: no output run ever contains ⟨ or ⟩ when every marker is closed', () => {
		const closed = [
			'',
			'no markers',
			'⟨⟩',
			'⟨  ⟩',
			'⟨dont⟩',
			'⟨ dont ⟩',
			'I ⟨⟩ know',
			'I ⟨dont⟩ ⟨rememebr⟩ being this wrong about someone',
			'⟨dont⟩⟨rememebr⟩',
			'⟨ unmatched ⟩ but closed',
			'multi\nline ⟨dont⟩ text',
			'⟨⟩ leading and trailing ⟨⟩',
		];
		for (const text of closed) {
			const joined = splitRepairRuns(text, repairs)
				.map((r) => r.t)
				.join('');
			expect(joined, JSON.stringify(text)).not.toMatch(/[⟨⟩]/);
			// And no run carries a bracket on its own either.
			for (const run of splitRepairRuns(text, repairs)) {
				expect(run.t, JSON.stringify(text)).not.toMatch(/[⟨⟩]/);
			}
		}
	});

	it('leaves an unclosed ⟨ as literal text rather than eating the rest of the line', () => {
		for (const text of ['an ⟨unclosed token', 'a stray ⟩ closer', '⟨', '⟩']) {
			expect(splitRepairRuns(text, repairs), JSON.stringify(text)).toEqual([
				{ t: text, repair: null },
			]);
		}
	});
});

describe('unquote', () => {
	it('strips one balanced wrapping pair', () => {
		expect(unquote('"chopped unc"')).toBe('chopped unc');
		expect(unquote('“chopped unc”')).toBe('chopped unc');
		expect(unquote("'chopped unc'")).toBe('chopped unc');
	});

	it('strips exactly one pair, not all of them', () => {
		expect(unquote('""chopped unc""')).toBe('"chopped unc"');
	});

	it('leaves interior quotes alone', () => {
		expect(unquote('he said "hi" and left')).toBe('he said "hi" and left');
		expect(unquote('"he said "hi" and left"')).toBe('he said "hi" and left');
	});

	it('leaves unbalanced quotes alone', () => {
		expect(unquote('"chopped unc')).toBe('"chopped unc');
		expect(unquote('chopped unc"')).toBe('chopped unc"');
		expect(unquote("'chopped unc")).toBe("'chopped unc");
	});

	// Only a MATCHING pair strips. A single character class on both ends ate
	// these, so `"foo'` came back as `foo`.
	it('leaves a mismatched pair alone', () => {
		expect(unquote('"chopped unc\'')).toBe('"chopped unc\'');
		expect(unquote('\'chopped unc"')).toBe('\'chopped unc"');
		expect(unquote('“chopped unc"')).toBe('“chopped unc"');
		expect(unquote('"chopped unc”')).toBe('"chopped unc”');
		// Smart quotes are directional: a closer can't open the pair.
		expect(unquote('”chopped unc“')).toBe('”chopped unc“');
		expect(unquote('“chopped unc“')).toBe('“chopped unc“');
	});

	it('handles one- and zero-character strings without slicing them away', () => {
		expect(unquote('"')).toBe('"');
		expect(unquote('x')).toBe('x');
		expect(unquote('""')).toBe('');
	});

	it('trims surrounding whitespace, inside and out', () => {
		expect(unquote('  " chopped unc "  ')).toBe('chopped unc');
		expect(unquote('   ')).toBe('');
	});

	it('leaves an unquoted string untouched', () => {
		expect(unquote('chopped unc')).toBe('chopped unc');
		expect(unquote('')).toBe('');
	});
});
