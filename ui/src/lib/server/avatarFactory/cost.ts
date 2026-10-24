export interface CostedRecord {
	source?: string;
	themeSlug?: string;
	costUsd?: number;
	costEstimated?: boolean;
}

export interface CostBucket {
	actualUsd: number;
	estimatedUsd: number;
	importedCount: number;
	generatedCount: number;
}

export function emptyCostBucket(): CostBucket {
	return { actualUsd: 0, estimatedUsd: 0, importedCount: 0, generatedCount: 0 };
}

export function addRecordCost(bucket: CostBucket, rec: CostedRecord): CostBucket {
	if (rec.source === 'imported') {
		bucket.importedCount += 1;
		return bucket;
	}
	bucket.generatedCount += 1;
	const usd = typeof rec.costUsd === 'number' ? rec.costUsd : 0;
	if (rec.costEstimated) bucket.estimatedUsd += usd;
	else bucket.actualUsd += usd;
	return bucket;
}

export function factoryCostTotals(
	state: {
		leagues: Record<
			string,
			{ members: { candidates: CostedRecord[] }[]; groupShots: CostedRecord[] }
		>;
	},
	leagueSlug: string,
): { overall: CostBucket; league: CostBucket; themes: Record<string, CostBucket> } {
	const overall = emptyCostBucket();
	const league = emptyCostBucket();
	const themes: Record<string, CostBucket> = {};

	for (const [slug, rec] of Object.entries(state.leagues)) {
		const rows: CostedRecord[] = [
			...rec.members.flatMap((m) => m.candidates),
			...rec.groupShots,
		];
		for (const row of rows) {
			addRecordCost(overall, row);
			if (slug === leagueSlug) {
				addRecordCost(league, row);
				const theme = row.themeSlug || '_';
				themes[theme] ??= emptyCostBucket();
				addRecordCost(themes[theme], row);
			}
		}
	}
	return { overall, league, themes };
}
