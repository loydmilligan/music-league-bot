import { describe, it, expect } from 'vitest';
import { buildSeasonUpdateMessages, SeasonUpdateOutputSchema } from './seasonUpdate.js';
import type { SeasonSignals } from '../seasonSignals.js';

function baseSignals(overrides: Partial<SeasonSignals> = {}): SeasonSignals {
	return {
		asOfRound: { roundNumber: 3, name: 'Summer Bops' },
		bigMover: { player: 'Matt', fromRank: 4, toRank: 1, rankDelta: 3, roundPoints: 12, total: 45 },
		faller: { player: 'Jordan', fromRank: 1, toRank: 3, rankDelta: -2, roundPoints: 2, total: 40 },
		streaks: [{ player: 'Mara', direction: 'surging', rounds: 3, detail: '3 straight rounds climbing' }],
		discoveryShifts: [{ player: 'Chris', direction: 'went-safe', detail: 'tastemaker score 80 -> 30' }],
		rivalries: [{ kind: 'reciprocal-downvote', players: ['Matt', 'Jordan'], rounds: [1, 2], detail: 'traded downvotes across 2 round(s)' }],
		upcomingTension: { contenders: [{ player: 'Matt', total: 45, gapToLeader: 0 }, { player: 'Jordan', total: 40, gapToLeader: 5 }], nextRound: { roundNumber: 4, name: 'Deep Cuts' } },
		punchingBagGuard: ['Jordan', 'Matt'],
		...overrides,
	};
}

describe('buildSeasonUpdateMessages', () => {
	it('includes the as-of round number and name', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: [] });
		const user = msgs.find(m => m.role === 'user')!.content;
		expect(user).toContain('3');
		expect(user).toContain('Summer Bops');
	});

	it('includes bigMover fact', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: [] });
		const user = msgs.find(m => m.role === 'user')!.content;
		expect(user).toContain('Matt');
		expect(user).toContain('rank 4->1');
	});

	it('includes faller fact', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: [] });
		const user = msgs.find(m => m.role === 'user')!.content;
		expect(user).toContain('Jordan');
		expect(user).toContain('rank 1->3');
	});

	it('includes streak fact', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: [] });
		const user = msgs.find(m => m.role === 'user')!.content;
		expect(user).toContain('Mara');
		expect(user).toContain('surging');
	});

	it('includes rivalry fact', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: [] });
		const user = msgs.find(m => m.role === 'user')!.content;
		expect(user).toContain('reciprocal-downvote');
	});

	it('includes snark level in system prompt', () => {
		const gentle = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 0, signals: baseSignals(), recentSubjects: [] });
		const spicy  = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 2, signals: baseSignals(), recentSubjects: [] });
		const sysGentle = gentle.find(m => m.role === 'system')!.content;
		const sysSpicy  = spicy.find(m => m.role === 'system')!.content;
		expect(sysGentle).toContain('gentle');
		expect(sysSpicy).toContain('spicy');
	});

	it('includes punching-bag suppression list in system prompt', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: ['Jordan', 'Matt'] });
		const sys = msgs.find(m => m.role === 'system')!.content;
		expect(sys).toContain('Jordan');
		expect(sys).toContain('Matt');
		expect(sys).toContain('pile on');
	});

	it('includes artists-OK-songs-forbidden guardrail', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: [] });
		const sys = msgs.find(m => m.role === 'system')!.content;
		expect(sys).toContain('artists');
		expect(sys).toContain('songs');
	});

	it('includes safe-targets Matt/Mara/Jordan guardrail', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: [] });
		const sys = msgs.find(m => m.role === 'system')!.content;
		expect(sys).toContain('Matt');
		expect(sys).toContain('Mara');
		expect(sys).toContain('Jordan');
	});

	it('includes funny/fact-based-never-cruel constraint', () => {
		const msgs = buildSeasonUpdateMessages({ leagueName: 'Fam-Jam', season: 'S3', snarkLevel: 1, signals: baseSignals(), recentSubjects: [] });
		const sys = msgs.find(m => m.role === 'system')!.content;
		expect(sys.toLowerCase()).toContain('fact');
		expect(sys.toLowerCase()).toContain('funny');
	});
});

describe('SeasonUpdateOutputSchema', () => {
	it('parses a valid {title, body} object', () => {
		const result = SeasonUpdateOutputSchema.safeParse({ title: 'Season Heats Up', body: 'Matt surges to the top.' });
		expect(result.success).toBe(true);
	});

	it('rejects missing body', () => {
		expect(SeasonUpdateOutputSchema.safeParse({ title: 'Hi' }).success).toBe(false);
	});
});
