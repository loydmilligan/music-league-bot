import { describe, expect, it } from 'vitest';
import { deriveTasks } from './plan.ts';
import type { Round, Season } from '../types.js';

function rk(...keys: string[]) {
	const set = new Set(keys);
	return (k: string) => set.has(k);
}

const season: Season = { id: 1, leagueId: 7, seasonNumber: 2, status: 'active' };

function mkRounds(n: number, opts: { surveyed?: number[] } = {}): Round[] {
	const base = Date.parse('2026-09-01T00:00:00Z');
	const surveyed = new Set(opts.surveyed ?? []);
	return Array.from({ length: n }, (_, i) => {
		const num = i + 1;
		const sub = new Date(base + i * 14 * 864e5).toISOString();
		const vote = new Date(base + i * 14 * 864e5 + 7 * 864e5).toISOString();
		return {
			id: num, seasonId: 1, mlRoundId: `r${num}`, name: `Round ${num}`,
			description: null, spotifyPlaylistUrl: null,
			submissionDeadline: sub, votingDeadline: vote, createdAt: sub,
			roundNumber: num, managedBy: surveyed.has(num) ? 'survey-2' : null,
		} satisfies Round;
	});
}

describe('deriveTasks', () => {
	it('lands season-level milestones in order', () => {
		const tasks = deriveTasks(season, mkRounds(10, { surveyed: [2, 3, 4, 5, 6, 7, 8, 9, 10] }));
		const by = (k: string) => tasks.find((t) => t.key === k)!;
		expect(by('season.start').dueAt).not.toBeNull();
		expect(by('season.start').dueAt! < by('r1.submission').dueAt!).toBe(true);
		expect(by('season.wrap').dueAt! > by('season.yearbook').dueAt!).toBe(true);
		expect(by('season.midseason').roundNumber).toBeNull();
	});

	it('R1 review is due when R2 enters submission', () => {
		const tasks = deriveTasks(season, mkRounds(10));
		const r1rev = tasks.find((t) => t.key === 'r1.round-review')!;
		const r2sub = tasks.find((t) => t.key === 'r2.submission')!;
		expect(r1rev.dueAt).toBe(r2sub.dueAt);
	});

	it('derives the full 10-round checklist (survey rounds get r{n}.next-survey)', () => {
		const tasks = deriveTasks(season, mkRounds(10, { surveyed: [2, 3, 4, 5, 6, 7, 8, 9, 10] }));
		expect(tasks.length).toBe(122);
		expect(tasks.filter((t) => t.key.endsWith('.next-reveal')).length).toBe(9);
		expect(tasks.filter((t) => t.key.endsWith('.next-survey')).length).toBe(9);
		expect(tasks.some((t) => t.key === 'r10.next-reveal')).toBe(false);
		expect(rk(...tasks.map((t) => t.key))('r10.round-review')).toBe(true);
	});

	it('no survey-managed next round skips r{n}.next-survey', () => {
		const tasks = deriveTasks(season, mkRounds(3));
		expect(tasks.some((t) => t.key.endsWith('.next-survey'))).toBe(false);
		expect(tasks.some((t) => t.key === 'r2.next-reveal')).toBe(true);
	});

	it('a missing submission deadline falls back to vote − 3 days for voting-start tasks', () => {
		const rounds = mkRounds(2);
		const r2 = rounds[1];
		r2.submissionDeadline = null;
		const tasks = deriveTasks(season, rounds);
		const vs = tasks.find((t) => t.key === 'r2.voting-rules')!.dueAt!;
		const vote = new Date(r2.votingDeadline!).getTime();
		expect(new Date(vs).getTime()).toBe(vote - 3 * 864e5);
		const cap = tasks.find((t) => t.key === 'r2.capture-spotify')!.dueAt!;
		expect(new Date(cap).getTime()).toBe(vote - 3 * 864e5 + 36e5);
	});

	it('missing anchors leave the row present but unscheduled', () => {
		const rounds = mkRounds(1);
		rounds[0].votingDeadline = null;
		const tasks = deriveTasks(season, rounds);
		expect(tasks.find((t) => t.key === 'r1.digest-edit')!.dueAt).toBeNull();
		expect(tasks.some((t) => t.key === 'r1.digest-edit')).toBe(true);
	});

	it('returns nothing when there are no rounds', () => {
		expect(deriveTasks(season, [])).toEqual([]);
		expect(deriveTasks(season, [{ ...mkRounds(1)[0], roundNumber: null }])).toEqual([]);
	});
});