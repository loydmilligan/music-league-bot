// portal.json (v1) — written per league by ui/src/lib/portal/portalJson.ts. Keep in sync.
import type { ArchiveEntry } from './types.js';

export interface PortalDigest {
	roundId: number; n: number; season: number; theme: string; date: string;
	winnerSong: string; winnerArtist: string; submitter: string; votes: number; hue: string;
	digestUrl: string | null; digestKind: 'v2' | 'v1' | null;
}
/**
 * Deep-link buttons for the Home "Current round" card. Optional-only on this
 * side: a stale portal.json on disk predates these fields, and the writer's
 * `n` is the season feed's `round` (rounds.round_number). `sections` carries
 * only display config — enabled flags, cards, links, selected KPIs, excluded
 * players; never prompts, frequencies or run history.
 */
export interface PortalSections {
	thisWeek: { cards: { latestDigest: boolean; currentRound: boolean; openPolls: boolean; themeSurvey: boolean }; links: { spotify: boolean; ytm: boolean; youtube: boolean; musicLeague: boolean } };
	byNumbers: { kpis: string[] };
	family: { excluded: string[] };
	enabled: Record<string, boolean>;
}
export interface PortalRoundLinks {
	n: number;
	spotify: string | null;
	ytm: string | null;
	youtube: string | null;
	musicLeague: string | null;
}
export interface PortalJson {
	version: 1; generatedAt: string;
	seasonFeedUrl: string | null; seasonHubUrl: string | null;
	survey?: { apiBase: string } | null;
	sections?: PortalSections | null;
	roundLinks?: PortalRoundLinks[];
	digests: PortalDigest[];
	stats: { updatedAt: string; current: number; seasons: number[] } | null;
}
export type PortalDigestView = Omit<PortalDigest, 'roundId' | 'digestKind'> & {
	roundId: number | null;
	digestKind: 'v2' | 'v1' | null;
};

export function roundLinksFor(
	portal: PortalJson | null,
	n: number
): PortalRoundLinks | null {
	if (!portal || !Array.isArray(portal.roundLinks)) return null;
	return portal.roundLinks.find((r) => r.n === n) ?? null;
}

export async function loadPortal(slug: string): Promise<PortalJson | null> {
	try {
		const r = await fetch(`/${slug}/portal.json`);
		if (!r.ok) return null;
		const j = (await r.json()) as PortalJson | null;
		if (!j || j.version !== 1 || !Array.isArray(j.digests)) return null;
		return j;
	} catch {
		return null;
	}
}

export function digestsFor(
	readModel: { archive: ArchiveEntry[] },
	portal: PortalJson | null
): PortalDigestView[] {
	if (portal) return portal.digests;
	return readModel.archive.map((a) => ({
		roundId: null, n: a.n, season: a.season, theme: a.theme, date: a.date,
		winnerSong: a.winnerSong, winnerArtist: a.winnerArtist, submitter: a.submitter,
		votes: a.votes, hue: a.hue, digestUrl: a.digestUrl ?? null, digestKind: null
	}));
}

// Relative href from the current SPA path to the static stats pages at /<slug>/stats/.
// Browsers resolve relative URLs against the path's directory, so '/s' (no trailing
// slash) resolves against '/' and needs the slug segment; deeper paths climb back out.
export function statsHrefFor(pathname: string, slug: string): string {
	const segs = pathname.split('/').filter(Boolean);
	if (segs[0] !== slug) return `${slug}/stats/`;
	const endsWithSlash = pathname.endsWith('/');
	if (segs.length === 1 && !endsWithSlash) return `${slug}/stats/`;
	const dirDepth = (endsWithSlash ? segs.length : segs.length - 1) - 1;
	return '../'.repeat(dirDepth) + 'stats/';
}
