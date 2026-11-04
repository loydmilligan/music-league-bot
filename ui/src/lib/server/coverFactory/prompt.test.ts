import { describe, it, expect } from 'vitest';
import { SEAMLESS_GOAL, buildSwapPrompt, defaultTreatments, type Treatment } from './prompt';
import type { Breakdown, Subject } from './breakdown';

const subj = (label: string, role: Subject['role'], kind: Subject['kind'] = 'person'): Subject => ({
	label, kind, role, position: `pos ${label}`, pose: 'standing', gaze: 'at camera', clothing: 'a red cap and tee',
	expression: 'neutral', color_treatment: 'full color', focus: 'sharp'
});
const bd = (subjects: Subject[]): Breakdown => ({
	style: 'grainy 90s photo', composition: 'centered', palette_lighting: 'warm', text_elements: ['TITLE top'], subjects, no_subjects: !subjects.length
});
const ids = [
	{ slug: 'berto', name: 'Berto', features: 'round face, thick brows, beard' },
	{ slug: 'koz', name: 'Koz', features: 'narrow face, glasses' }
];

describe('buildSwapPrompt', () => {
	it('contains SEAMLESS_GOAL verbatim', () => {
		const t: Treatment[] = [{ label: 'A', mode: 'player', playerSlug: 'berto', playerName: 'Berto' }];
		expect(buildSwapPrompt(bd([subj('A', 'main')]), t, ids).prompt).toContain(SEAMLESS_GOAL);
	});
	it('player treatment references image 2, features, headwear wording', () => {
		const t: Treatment[] = [{ label: 'A', mode: 'player', playerSlug: 'berto', playerName: 'Berto' }];
		const r = buildSwapPrompt(bd([subj('A', 'main')]), t, ids);
		expect(r.prompt).toContain('image 2');
		expect(r.prompt).toContain('round face, thick brows, beard');
		expect(r.prompt).toContain('headwear from the cover');
		expect(r.imageOrder).toEqual(['cover', 'berto']);
	});
	it('clothing override replaces keep-original clothing', () => {
		const t: Treatment[] = [{ label: 'A', mode: 'player', playerSlug: 'berto', playerName: 'Berto', clothing: 'jean shorts' }];
		const p = buildSwapPrompt(bd([subj('A', 'main')]), t, ids).prompt;
		expect(p).toContain('jean shorts');
		expect(p).not.toContain('keep the original clothing');
	});
	it('same slug twice yields one image slot', () => {
		const t: Treatment[] = [
			{ label: 'A', mode: 'player', playerSlug: 'berto', playerName: 'Berto' },
			{ label: 'B', mode: 'player', playerSlug: 'berto', playerName: 'Berto' }
		];
		const r = buildSwapPrompt(bd([subj('A', 'secondary'), subj('B', 'secondary')]), t, ids);
		expect(r.imageOrder).toEqual(['cover', 'berto']);
		expect(r.prompt.match(/image 2/g)!.length).toBeGreaterThanOrEqual(2);
		expect(r.prompt).not.toContain('image 3');
	});
	it('two players get images 2 and 3', () => {
		const t: Treatment[] = [
			{ label: 'A', mode: 'player', playerSlug: 'berto', playerName: 'Berto' },
			{ label: 'B', mode: 'player', playerSlug: 'koz', playerName: 'Koz' }
		];
		const r = buildSwapPrompt(bd([subj('A', 'secondary'), subj('B', 'secondary')]), t, ids);
		expect(r.imageOrder).toEqual(['cover', 'berto', 'koz']);
		expect(r.prompt).toContain('image 3');
	});
	it('keep-only has no "becomes"; remove says remove', () => {
		const k = buildSwapPrompt(bd([subj('A', 'main')]), [{ label: 'A', mode: 'keep' }], ids);
		expect(k.prompt).not.toContain('becomes');
		expect(k.imageOrder).toEqual(['cover']);
		const r = buildSwapPrompt(bd([subj('A', 'main')]), [{ label: 'A', mode: 'remove' }], ids);
		expect(r.prompt).toContain('Remove subject A and fill naturally.');
		expect(r.prompt).toContain('Do not change anything else. Square output.');
	});
});

describe('defaultTreatments', () => {
	const sub = { slug: 'berto', name: 'Berto' };
	it('5 secondary persons -> 5 player treatments', () => {
		const b = bd(['A', 'B', 'C', 'D', 'E'].map((l) => subj(l, 'secondary')));
		const t = defaultTreatments(b, sub);
		expect(t.filter((x) => x.mode === 'player')).toHaveLength(5);
	});
	it('with a main -> exactly one player, others keep', () => {
		const b = bd([subj('A', 'main'), subj('B', 'secondary'), subj('C', 'background')]);
		const t = defaultTreatments(b, sub);
		expect(t.filter((x) => x.mode === 'player').map((x) => x.label)).toEqual(['A']);
		expect(t.filter((x) => x.mode === 'keep')).toHaveLength(2);
	});
	it('no people -> all keep', () => {
		const t = defaultTreatments(bd([subj('A', 'main', 'object')]), sub);
		expect(t.every((x) => x.mode === 'keep')).toBe(true);
	});
});
