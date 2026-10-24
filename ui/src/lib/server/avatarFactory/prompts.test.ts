import { describe, expect, it } from 'vitest';
import { GLOBAL_NOTES } from './notes.js';
import {
	assembleAvatarPrompt,
	assembleGroupShotPrompt,
	assembleRatingNotes,
	extractFencedPrompt,
	parseAttachInspiration,
	truncatePromptKeepNotes,
} from './prompts.js';

describe('prompt assembly', () => {
	it('includes member notes and height class', () => {
		const prompt = assembleAvatarPrompt({
			stylePrompt: 'Draw a South Park cutout.',
			memberSlug: 'clements-johnson',
			memberName: 'Clements Johnson',
			memberNotes: 'Not bald. No glasses. Barely any beard.',
			notesMd: '# Clements\n- Height: TALLEST',
			height: 'tallest',
		});
		expect(prompt).toContain('Draw a South Park cutout.');
		expect(prompt).toContain('Not bald. No glasses. Barely any beard.');
		expect(prompt).toContain('TALLEST');
		expect(prompt).toContain('# Clements');
		expect(prompt).toContain(GLOBAL_NOTES.split('\n')[0]);
	});

	it('includes liked vs fix rated comments', () => {
		const ratingNotes = assembleRatingNotes([
			{ letter: 'A', rating: 5, comment: 'great hair' },
			{ letter: 'B', rating: 1, comment: 'too bald' },
			{ letter: 'C', rating: 4, comment: '' },
		]);
		expect(ratingNotes).toMatch(/KEEP[\s\S]*great hair/);
		expect(ratingNotes).toMatch(/FIX[\s\S]*too bald/);
		expect(ratingNotes).not.toContain('C (');
		const prompt = assembleAvatarPrompt({
			stylePrompt: 'style',
			memberSlug: 'matt-mariani',
			memberName: 'Matt',
			memberNotes: '',
			notesMd: '',
			height: 'tall',
			ratingNotes,
		});
		expect(prompt).toContain('RATED CANDIDATE NOTES:');
		expect(prompt).toContain('great hair');
		expect(prompt).toContain('too bald');
	});

	it('appends a tweak note when present', () => {
		const prompt = assembleAvatarPrompt({
			stylePrompt: 'style',
			memberSlug: 'shane-farkas',
			memberName: 'Shane',
			memberNotes: 'thick beard',
			notesMd: '',
			height: 'short',
			tweakNote: 'more hair on the sides',
		});
		expect(prompt).toContain('more hair on the sides');
		expect(prompt).toMatch(/height class short/i);
	});

	it('group-shot prompt lists every member height', () => {
		const prompt = assembleGroupShotPrompt({
			stylePrompt: 'yellow sitcom cel',
			themeName: 'Simpsons',
			members: [
				{ slug: 'ronnie-bertolina', name: 'Ronnie', height: 'short', notes: 'new photo' },
				{ slug: 'clements-johnson', name: 'Clements', height: 'tallest', notes: 'not bald' },
			],
		});
		expect(prompt).toContain('ronnie-bertolina');
		expect(prompt).toContain('short');
		expect(prompt).toContain('tallest of all');
		expect(prompt).toContain('not bald');
	});

	it('truncates long prompts but keeps member notes and KEEP/FIX first', () => {
		const keep = 'KEEP (high-rated — preserve what was liked):\n- A (5/5): great hair';
		const assembled = `${'STYLE '.repeat(400)}\nMEMBER NOTES (must follow):\nglasses\n${keep}`;
		expect(assembled.length).toBeGreaterThan(1000);
		const fit = truncatePromptKeepNotes(assembled, ['glasses', keep], 1000);
		expect(fit.truncated).toBe(true);
		expect(fit.text.length).toBeLessThanOrEqual(1000);
		expect(fit.text).toContain('great hair');
		expect(fit.text).toContain('glasses');
	});

	it('extracts the fenced style.md template', () => {
		const md = '# x\n\n```\nTHE TEMPLATE\n```\n';
		expect(extractFencedPrompt(md)).toBe('THE TEMPLATE');
		expect(parseAttachInspiration('api_attach_inspiration: false\n')).toBe(false);
		expect(parseAttachInspiration('# south-park\n')).toBe(true);
	});
});
