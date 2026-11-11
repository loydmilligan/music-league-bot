import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoundAwards } from './awards.js';

let dir: string;
const cand = (n: number, who: string, reactions: unknown = null) => ({
	n, who, authorId: null, text: `msg ${n}`, ts: '2026-11-03T20:05:00Z', msgId: null, reactions
});
const round = (award: string, roundId: number, extra: object = {}) => ({
	award, roundId, approvals: [], picks: { 1: 2, 2: 1, 3: 3 },
	candidates: [cand(1, 'Ann'), cand(2, 'Bo', [{ emoji: '😂', who: ['Cy'] }]), cand(3, 'Cy')], ...extra
});
const cfg = { awards: [{ key: 'bbb', name: 'Big Brain Bit', day: 1 }, { key: 'hba', name: 'Half Baked', day: 6 }] };

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'aw-'));
	await mkdir(join(dir, 'awards'), { recursive: true });
});
const put = (rounds: unknown[]) =>
	Promise.all([
		writeFile(join(dir, 'awards', 'config.json'), JSON.stringify(cfg)),
		writeFile(join(dir, 'awards', 'rounds.json'), JSON.stringify(rounds))
	]);

describe('loadRoundAwards', () => {
	it('hides unposted awards and other rounds', async () => {
		await put([round('bbb', 5), round('hba', 5, { postedAt: '2026-11-08T16:00:00Z' }), round('bbb', 6, { postedAt: '2026-11-03T16:00:00Z' })]);
		expect((await loadRoundAwards(dir, 5)).map((a) => a.key)).toEqual(['hba']);
	});
	it('sorts by day', async () => {
		const p = { postedAt: '2026-11-08T16:00:00Z' };
		await put([round('hba', 5, p), round('bbb', 5, p)]);
		expect((await loadRoundAwards(dir, 5)).map((a) => a.key)).toEqual(['bbb', 'hba']);
	});
	it('missing rounds.json gives []', async () => {
		expect(await loadRoundAwards(dir, 5)).toEqual([]);
	});
	it('maps poster basename, top3, LA time, first emoji', async () => {
		await put([round('bbb', 5, { postedAt: '2026-11-03T16:00:00Z', poster: '/app/data/awards/posters/x1.png' })]);
		const [a] = await loadRoundAwards(dir, 5);
		expect(a.poster).toBe('awards/x1.png');
		expect(a.name).toBe('Big Brain Bit');
		expect(a.top3.map((t) => [t.place, t.who, t.emoji])).toEqual([[1, 'Bo', '😂'], [2, 'Ann', ''], [3, 'Cy', '']]);
		expect(a.top3[0].when).toBe('Tue Nov 3 12:05 PM');
	});
	it('no poster gives empty poster string', async () => {
		await put([round('bbb', 5, { postedAt: '2026-11-03T16:00:00Z' })]);
		expect((await loadRoundAwards(dir, 5))[0].poster).toBe('');
	});
});
