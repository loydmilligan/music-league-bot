// Pure, dependency-free normalizer for the survey app's public season feed (v1).
// Defensive by design: teaser rounds are built ONLY from teaser fields + dates, so
// hidden round info can never surface even if the feed regressed.

export interface SeasonRound {
	round: number;
	status: 'revealed' | 'teaser';
	title: string;
	description: string | null;
	commentRule: { level: 'required' | 'suggested'; prompt: string; hiddenUntilVotingEnds: boolean } | null;
	credit: string[];
	revealAt: string | null;
	startsAt: string | null;
	songsDue: string | null;
	votesDue: string | null;
}
export interface SeasonPollOpen {
	id: string;
	round: number | null;
	question: string;
	blurb: string | null;
	options: { id: string; label: string; description: string | null }[];
	closesAt: string | null;
}
export interface SeasonPollClosed {
	id: string;
	round: number | null;
	question: string;
	blurb: string | null;
	results: { label: string; votes: number }[];
	winner: string | null;
	closedAt: string | null;
}
export interface SeasonFeed {
	leagueName: string;
	season: number;
	surveyOpen: boolean;
	links: { hub: string | null; polls: string | null; mine: string | null; survey: string | null };
	lineup: SeasonRound[];
	pollsOpen: SeasonPollOpen[];
	pollsClosed: SeasonPollClosed[];
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const int = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) ? x : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

function https(x: unknown): string | null {
	const s = str(x);
	if (!s) return null;
	try {
		return new URL(s).protocol === 'https:' ? s : null;
	} catch {
		return null;
	}
}

function round(raw: unknown): SeasonRound | null {
	if (!isObj(raw)) return null;
	const n = int(raw.round);
	if (n === null) return null;
	const dates = {
		startsAt: str(raw.startsAt),
		songsDue: str(raw.songsDue),
		votesDue: str(raw.votesDue)
	};
	if (raw.status === 'teaser') {
		const t = isObj(raw.teaser) ? raw.teaser : {};
		return {
			round: n,
			status: 'teaser',
			title: str(t.title)?.trim() || 'Mystery round',
			description: str(t.description) || null,
			commentRule: null,
			credit: [],
			revealAt: str(raw.revealAt),
			...dates
		};
	}
	if (raw.status !== 'revealed') return null;
	const cr = isObj(raw.commentRule) ? raw.commentRule : null;
	const level = cr?.level === 'required' || cr?.level === 'suggested' ? cr.level : null;
	return {
		round: n,
		status: 'revealed',
		title: str(raw.title) ?? '',
		description: str(raw.description),
		commentRule: cr && level ? { level, prompt: str(cr.prompt) ?? '', hiddenUntilVotingEnds: cr.hiddenUntilVotingEnds === true } : null,
		credit: arr(raw.credit).filter((c): c is string => typeof c === 'string'),
		revealAt: null,
		...dates
	};
}

function pollOpen(raw: unknown): SeasonPollOpen | null {
	if (!isObj(raw)) return null;
	const id = str(raw.id);
	const question = str(raw.question);
	if (!id || question === null) return null;
	const options = arr(raw.options).flatMap((o) => {
		if (!isObj(o)) return [];
		const oid = str(o.id);
		const label = str(o.label);
		return oid && label !== null ? [{ id: oid, label, description: str(o.description) }] : [];
	});
	return { id, round: int(raw.round), question, blurb: str(raw.blurb), options, closesAt: str(raw.closesAt) };
}

function pollClosed(raw: unknown): SeasonPollClosed | null {
	if (!isObj(raw)) return null;
	const id = str(raw.id);
	const question = str(raw.question);
	if (!id || question === null) return null;
	const results = arr(raw.results)
		.flatMap((r) => {
			if (!isObj(r)) return [];
			const label = str(r.label);
			const votes = typeof r.votes === 'number' && Number.isFinite(r.votes) ? r.votes : null;
			return label !== null && votes !== null ? [{ label, votes }] : [];
		})
		.sort((a, b) => b.votes - a.votes);
	return { id, round: int(raw.round), question, blurb: str(raw.blurb), results, winner: str(raw.winner), closedAt: str(raw.closedAt) };
}

export function normalizeSeasonFeed(raw: unknown): SeasonFeed | null {
	if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.lineup)) return null;
	const league = isObj(raw.league) ? raw.league : {};
	const links = isObj(raw.links) ? raw.links : {};
	const polls = isObj(raw.polls) ? raw.polls : {};
	const nonNull = <T>(x: T | null): x is T => x !== null;
	return {
		leagueName: str(league.name) ?? '',
		season: int(league.season) ?? 0,
		surveyOpen: isObj(raw.survey) && raw.survey.open === true,
		links: { hub: https(links.hub), polls: https(links.polls), mine: https(links.mine), survey: https(links.survey) },
		lineup: raw.lineup.map(round).filter(nonNull).sort((a, b) => a.round - b.round),
		pollsOpen: arr(polls.open).map(pollOpen).filter(nonNull),
		pollsClosed: arr(polls.closed).map(pollClosed).filter(nonNull)
	};
}
