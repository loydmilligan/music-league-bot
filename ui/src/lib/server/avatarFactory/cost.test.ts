import { describe, expect, it } from 'vitest';
import { addRecordCost, emptyCostBucket, factoryCostTotals } from './cost.js';

describe('cost totals', () => {
	it('keeps imported at $0 and splits actual vs estimate', () => {
		const b = emptyCostBucket();
		addRecordCost(b, { source: 'imported', costUsd: 9 });
		addRecordCost(b, { source: 'generated', costUsd: 0.02, costEstimated: false });
		addRecordCost(b, { source: 'generated', costUsd: 0.04, costEstimated: true });
		expect(b.importedCount).toBe(1);
		expect(b.generatedCount).toBe(2);
		expect(b.actualUsd).toBeCloseTo(0.02);
		expect(b.estimatedUsd).toBeCloseTo(0.04);
	});

	it('rolls up overall, league, and per-theme buckets', () => {
		const totals = factoryCostTotals(
			{
				leagues: {
					'boarz-ii-men': {
						members: [
							{
								candidates: [
									{ source: 'imported', themeSlug: 'south-park', costUsd: 0 },
									{ source: 'generated', themeSlug: 'south-park', costUsd: 0.01, costEstimated: false },
									{ source: 'generated', themeSlug: 'simpsons', costUsd: 0.04, costEstimated: true },
								],
							},
						],
						groupShots: [
							{ source: 'generated', themeSlug: 'south-park', costUsd: 0.03, costEstimated: false },
						],
					},
					other: {
						members: [{ candidates: [{ source: 'generated', themeSlug: 'x', costUsd: 1, costEstimated: false }] }],
						groupShots: [],
					},
				},
			},
			'boarz-ii-men',
		);
		expect(totals.overall.actualUsd).toBeCloseTo(1.04);
		expect(totals.league.actualUsd).toBeCloseTo(0.04);
		expect(totals.league.estimatedUsd).toBeCloseTo(0.04);
		expect(totals.themes['south-park'].actualUsd).toBeCloseTo(0.04);
		expect(totals.themes['south-park'].importedCount).toBe(1);
		expect(totals.themes['simpsons'].estimatedUsd).toBeCloseTo(0.04);
	});
});
