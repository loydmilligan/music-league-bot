export interface StatsNav {
	leagueName: string;
	homeHref: string;
	digestsHref: string;
	seasonHref: string;
	seasons: { number: number; href: string; current: boolean; selected: boolean }[];
}

/** All hrefs are relative: the page is captured to <slug>/stats/ (depth 2) or <slug>/stats/s<N>/ (depth 3). */
export function buildStatsNav(o: {
	leagueName: string;
	depth: 2 | 3;
	seasons: number[];
	currentSeason: number;
	selectedSeason: number;
}): StatsNav {
	const up = o.depth === 2 ? '../' : '../../';
	const statsRoot = o.depth === 2 ? '' : '../';
	return {
		leagueName: o.leagueName,
		homeHref: up,
		digestsHref: up + 'archive',
		seasonHref: up + 'season',
		seasons: [...o.seasons]
			.sort((a, b) => b - a)
			.map((n) => ({
				number: n,
				href: n === o.currentSeason ? (o.depth === 2 ? './' : '../') : `${statsRoot}s${n}/`,
				current: n === o.currentSeason,
				selected: n === o.selectedSeason
			}))
	};
}
