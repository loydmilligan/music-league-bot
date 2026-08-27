import { describe, it, expect } from 'vitest';
import { parseExport } from './chatExport';

// U+202F narrow no-break space, as WhatsApp actually writes it.
const NNBSP = ' ';

describe('parseExport', () => {
	it('parses a plain message', () => {
		const out = parseExport(`7/11/26, 4:56${NNBSP}PM - Matt Mariani: hello there`);
		expect(out).toHaveLength(1);
		expect(out[0].sender).toBe('Matt Mariani');
		expect(out[0].text).toBe('hello there');
		expect(out[0].edited).toBe(false);
		expect(out[0].media).toBeNull();
	});

	it('accepts a regular space before AM/PM', () => {
		const out = parseExport('7/11/26, 4:56 PM - Matt Mariani: hi');
		expect(out).toHaveLength(1);
	});

	it('converts 12-hour to 24-hour correctly at the boundaries', () => {
		const noon = parseExport(`7/11/26, 12:30${NNBSP}PM - Jimmy: noon`)[0];
		const midnight = parseExport(`7/11/26, 12:30${NNBSP}AM - Jimmy: midnight`)[0];
		expect(new Date(noon.ts).getUTCHours()).toBe(12);
		expect(new Date(midnight.ts).getUTCHours()).toBe(0);
	});

	it('joins continuation lines into the previous message', () => {
		const out = parseExport(
			[`7/11/26, 4:56${NNBSP}PM - Jimmy: line one`, 'line two', 'line three'].join('\n'),
		);
		expect(out).toHaveLength(1);
		expect(out[0].text).toBe('line one\nline two\nline three');
	});

	it('extracts the edit marker instead of leaving it in the text', () => {
		const out = parseExport(
			`7/13/26, 6:36${NNBSP}PM - Darren Pallets: Ah for fuck's sake <This message was edited>`,
		);
		expect(out[0].edited).toBe(true);
		expect(out[0].text).toBe("Ah for fuck's sake");
	});

	it('flags media messages', () => {
		const out = parseExport(
			`7/15/26, 10:29${NNBSP}AM - Conor Johnston: IMG-20260715-WA0001.jpg (file attached)`,
		);
		expect(out[0].media).toBe('IMG-20260715-WA0001.jpg');
	});

	it('drops system lines that have no sender', () => {
		const out = parseExport(
			[
				`7/11/26, 3:57${NNBSP}PM - You created this group`,
				`7/11/26, 4:11${NNBSP}PM - You changed this group's icon`,
				`7/11/26, 4:13${NNBSP}PM - Matt Mariani: real message`,
			].join('\n'),
		);
		expect(out).toHaveLength(1);
		expect(out[0].text).toBe('real message');
	});

	it('does not let a system line absorb the next message as a continuation', () => {
		const out = parseExport(
			[
				`7/11/26, 4:56${NNBSP}PM - Matt Mariani: first`,
				`7/11/26, 4:57${NNBSP}PM - You created this group`,
				'stray continuation of nothing',
				`7/11/26, 4:58${NNBSP}PM - Jimmy: second`,
			].join('\n'),
		);
		expect(out.map((m) => m.text)).toEqual(['first', 'second']);
	});

	it('strips mention isolate markers and records the mention', () => {
		const out = parseExport(
			`7/16/26, 9:38${NNBSP}AM - Matt Mariani: waiting for @⁨Darren Pallets⁩ still`,
		);
		expect(out[0].text).toBe('waiting for @Darren Pallets still');
		expect(out[0].mentions).toEqual(['Darren Pallets']);
	});

	it('handles a 4-digit year', () => {
		const out = parseExport(`7/11/2026, 4:56${NNBSP}PM - Jimmy: hi`);
		expect(new Date(out[0].ts).getUTCFullYear()).toBe(2026);
	});

	it('keeps colons inside message text', () => {
		const out = parseExport(`7/11/26, 4:56${NNBSP}PM - Jimmy: the score was 3: nice`);
		expect(out[0].sender).toBe('Jimmy');
		expect(out[0].text).toBe('the score was 3: nice');
	});
});

describe('media-omitted exports (2026-08-27 refresh)', () => {
	// "Export without media" writes `<Media omitted>` instead of
	// `Filename.ext (file attached)`. Without handling, 339 of those lines
	// would each contribute the words "Media omitted" to every text metric.
	it('treats <Media omitted> as media contributing no words', () => {
		const out = parseExport('8/1/26, 4:56 PM - Jimmy: <Media omitted>');
		expect(out).toHaveLength(1);
		expect(out[0].media).not.toBeNull();
		expect(out[0].text).toBe('');
	});

	it('treats a deleted message as a message with no words', () => {
		const gone = parseExport('8/1/26, 4:56 PM - Jimmy: This message was deleted')[0];
		const mine = parseExport('8/1/26, 4:56 PM - Matt Mariani: You deleted this message')[0];
		expect(gone.deleted).toBe(true);
		expect(gone.text).toBe('');
		expect(mine.deleted).toBe(true);
		expect(mine.text).toBe('');
	});

	it('keeps an ordinary message undeleted', () => {
		expect(parseExport('8/1/26, 4:56 PM - Jimmy: hello')[0].deleted).toBe(false);
	});
});
