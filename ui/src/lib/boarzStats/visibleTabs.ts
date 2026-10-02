export interface TabLike {
	id: string;
	seasonOnly?: boolean;
	needsChat?: boolean;
}

export interface VisibleTabOpts {
	hasChat: boolean;
	isAllSeasons: boolean;
	crossSeasonView: 'combined' | 'hide-season';
	omitTabs: readonly string[];
}

/**
 * Which explorer tab ids are visible. Mirrors the StatsExplorer `visibleTabs`
 * rule, plus an explicit `omitTabs` list (used by the digest2 embedding to drop
 * tabs it relocates, e.g. the chat tab). Pure — no DOM, no URL.
 */
export function computeVisibleTabIds(tabs: readonly TabLike[], opts: VisibleTabOpts): string[] {
	const omit = new Set(opts.omitTabs);
	return tabs
		.filter((tab) => !tab.needsChat || opts.hasChat)
		.filter((tab) => !tab.seasonOnly || !opts.isAllSeasons || opts.crossSeasonView === 'combined')
		.filter((tab) => !omit.has(tab.id))
		.map((tab) => tab.id);
}
