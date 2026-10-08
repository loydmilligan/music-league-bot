import type { PortalDigestView, PortalJson } from './portal.js';
import type { SeasonFeed, SeasonPollOpen, SeasonRound } from './seasonFeed.js';
import type { NewsItem } from './surveyApi.js';

/**
 * Whether a Home screen section renders. Default-on intentionally: a stale or
 * missing `portal.json` (no `sections` block at all) must render everything
 * rather than nothing.
 */
export function sectionsEnabled(portal: PortalJson | null, id: string): boolean {
	return portal?.sections?.enabled?.[id] ?? true;
}

export function latestDigest(digests: PortalDigestView[]) {
	return digests.find((d) => d.digestKind === 'v2' && d.digestUrl) ?? digests.find((d) => d.digestUrl) ?? null;
}

export function upNext(feed: SeasonFeed | null, now = Date.now()): SeasonRound | null {
	if (!feed) return null;
	const upcoming = feed.lineup
		.filter((r) => {
			const due = r.songsDue || r.votesDue || r.startsAt;
			if (!due) return r.status === 'teaser' || r.status === 'revealed';
			return Date.parse(due) >= now;
		})
		.sort((a, b) => a.round - b.round);
	return upcoming[0] ?? feed.lineup[feed.lineup.length - 1] ?? null;
}

export interface CurrentRound {
	round: SeasonRound;
	phase: 'submission' | 'voting';
	/** songsDue while in submission, votesDue while in voting. */
	deadline: string;
}

/**
 * The round currently accepting songs or votes — the "Current round" card.
 * A round is in flight once it has started and before its voting deadline;
 * phase is `submission` while `now < songsDue`, `voting` after. Returns the
 * first in-flight round in the lineup (lowest round number). null with no feed
 * or nothing in flight, letting the Home fall back to `upNext()`.
 */
export function currentRound(feed: SeasonFeed | null, now = Date.now()): CurrentRound | null {
	if (!feed) return null;
	for (const round of feed.lineup) {
		// A teaser round has not been revealed, so it has no name to show and
		// cannot be the current round yet.
		if (round.status !== 'revealed') continue;
		if (!round.songsDue && !round.votesDue) continue;
		const votesDue = round.votesDue ? Date.parse(round.votesDue) : Number.POSITIVE_INFINITY;
		const songsDue = round.songsDue ? Date.parse(round.songsDue) : Number.NEGATIVE_INFINITY;
		if (Number.isNaN(votesDue)) continue;
		if (round.startsAt && now < Date.parse(round.startsAt)) continue;
		if (now >= votesDue) continue;
		const phase = now < songsDue ? 'submission' : 'voting';
		const deadline =
			phase === 'submission' ? (round.songsDue ?? round.votesDue!) : (round.votesDue ?? round.songsDue!);
		return { round, phase, deadline };
	}
	return null;
}

export function openPolls(feed: SeasonFeed | null): SeasonPollOpen[] {
	return feed?.pollsOpen ?? [];
}

export function latestNews(items: NewsItem[] | null): NewsItem | null {
	return items?.[0] ?? null;
}
