import { it, expect, describe } from 'vitest';
import { playerSuperlativesTask } from './generators/narrative.js';
import { FullMemberSchema } from './buildReadModel.js';

// Regression: Boarz II Men round 135 ("I Heard It Through the Napster").
// CJ Wookie's only submission — Alan Jackson's "Where Were You" — took 8
// downvotes against 4 upvotes and finished at -4, giving him avgPts = -4.0.
// `avgPts` was declared z.number().nonnegative() in both the player-superlatives
// input schema and the read-model Stat schema, so buildReadModel threw
//   ZodError: path ["stat","avgPts"] — "Too small: expected number to be >=0"
// and POST /api/content/5/publish 500'd. Music League scores are legitimately
// negative whenever downvotes outweigh upvotes, so avgPts must accept them.

const FINGERPRINT = {
	signature_artists: ['Alan Jackson'],
	genres: ['country'],
	eras: ['00s'],
	rewards: ['sincerity'],
	punishes: ['screamo'],
	summary: 'Earnest country partisan in a room of punk loyalists.',
	confidence: 'medium' as const,
};

describe('negative avgPts (downvoted into the red)', () => {
	it('accepts a negative avgPts in the player-superlatives input schema', () => {
		const result = playerSuperlativesTask.inputSchema.safeParse({
			playerName: 'CJ Wookie',
			leagueName: 'Boarz II Men',
			fingerprint: FINGERPRINT,
			stat: { submitted: 1, avgPts: -4, wins: 0 },
		});
		expect(result.success).toBe(true);
	});

	it('accepts a negative avgPts in the read-model member schema', () => {
		const result = FullMemberSchema.safeParse({
			name: 'CJ Wookie',
			stat: { submitted: 1, avgPts: -4, wins: 0 },
		});
		// The stat block must not be what rejects it. Other required fields may
		// still be missing in this partial fixture; assert specifically that no
		// issue is raised against stat.avgPts.
		const avgPtsIssues = result.success
			? []
			: result.error.issues.filter((i) => i.path.join('.') === 'stat.avgPts');
		expect(avgPtsIssues).toEqual([]);
	});

	it('still accepts zero and positive avgPts', () => {
		for (const avgPts of [0, 9.1]) {
			const result = playerSuperlativesTask.inputSchema.safeParse({
				playerName: 'Mashew',
				leagueName: 'Boarz II Men',
				fingerprint: FINGERPRINT,
				stat: { submitted: 1, avgPts, wins: 1 },
			});
			expect(result.success).toBe(true);
		}
	});
});
