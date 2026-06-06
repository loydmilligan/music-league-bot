import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  getActiveDraftForRound,
  getSectionsForDraft,
  type DigestDraftRow,
  type DigestSectionRow,
} from '$lib/digest/llm.js';
import type { TastemakerPayload } from '$lib/db/discoverability.js';
import { gatherSeasonData } from '$lib/db/seasonData.js';

// sprint-21 season-recap: framing the digest page applies to the DATA sections
// when the active draft was generated in recap mode (standings/stat-strip/
// tastemaker headings; next-round dropped). Final → champion/past; mid → "so far".
export type RecapContext = {
  enabled: boolean;
  final: boolean;
  champion: string | null;
  throughRound: number;
  totalRounds: number;
  seasonLabel: string;
};

export type PrepareCheck = {
  name: string;
  ok: boolean;
  src: string;
  count?: number;
  optional?: boolean;
};

// `variant` is a sprint-14 column on digest_sections (SELECT * picks it up at
// runtime; DigestSectionRow predates it, so we widen the type here).
export type SectionWithContent = DigestSectionRow & {
  content: unknown;
  variant?: 'textual' | 'visual' | 'both';
};

export type RoundIndexEntry = {
  id: number;
  name: string;
  voting_deadline: string | null;
  season_id: number;
  season_number: number;
  season_status: string;
  league_id: number;
  league_name: string;
};

export type CurrentRoundMeta = {
  id: number;
  name: string;
  voting_deadline: string | null;
  season_status: string;
  league_id: number;
};

export type RelContextSnapshot = {
  leagueId: number;
  context: string;
  previousContext: string | null;
  updatedAt: string | null;
  previousUpdatedAt: string | null;
  lastRoundId: number | null;
};

// Standings payload (GET /api/digest/:roundId/standings). Passed straight to
// StandingsChart as its visualData; we keep the shape loose here.
export type StandingsRow = {
  competitorId?: number;
  name: string;
  rank: number;
  prevRank: number | null;
  priorTotal: number;
  roundPoints: number;
  currentTotal: number;
};
export type StandingsPayload = {
  seasonId: number;
  standings: StandingsRow[];
  reconcile: { status: 'match' | 'mismatch'; diffs: unknown[] };
};

// sprint-17 data-driven section payloads (each fetched server-side, mirroring
// standings; passed to its section component as visualData). Shapes loose —
// the components read them defensively.
export type DigestStats = {
  totalVotes?: number;
  submitters?: number;
  blowoutMargin?: number;
  closestRace?: number;
  uniqueArtists?: number;
  // sprint-21 recap totals (StatStrip renders a season tile-set when `recap`).
  recap?: boolean;
  songs?: number;
  votes?: number;
  rounds?: number;
  players?: number;
  biggestRoundVotes?: number;
};
// Discoverability v2 (sprint-18): the Tastemaker payload (object with `.players`),
// not the v1 row array. Type owned by `$lib/db/discoverability.ts` — imported above.
export type NextRoundInfo = {
  theme?: string | null;
  deadline?: string | null;
  submissionsSoFar?: number | null;
};

type DigestPageBase = {
  roundId: number;
  roundsIndex: RoundIndexEntry[];
  currentRound: CurrentRoundMeta;
  relContext: RelContextSnapshot | null;
  // sprint-20 html-share hotfix: ?share=1 → bare layout (no app chrome). Lives
  // in the inlined LOAD data (not the live URL) so SSR-at-?share=1 and client
  // hydration-at-/d/<slug>/ agree — a URL-derived flag would mismatch and the
  // chrome would re-appear on hydration. The +layout reads `page.data.share`.
  share: boolean;
};

export type DigestPageData =
  | (DigestPageBase & { stage: 'prepare'; checks: PrepareCheck[] })
  | (DigestPageBase & {
      stage: 'refine' | 'finalize';
      draft: DigestDraftRow;
      sections: SectionWithContent[];
      standings: StandingsPayload | null;
      stats: DigestStats | null;
      discoverability: TastemakerPayload | null;
      nextRound: NextRoundInfo | null;
      recap: RecapContext | null;
    });

export const load: PageServerLoad = async ({ params, fetch, url }) => {
  const roundId = Number(params.roundId);
  if (!Number.isFinite(roundId)) throw error(400, 'invalid roundId');

  // Bare-layout share render (html-share artifact). Captured into the inlined
  // load data so it survives static re-serving at /d/<slug>/.
  const share = url.searchParams.get('share') === '1';

  const db = getDb();
  const round = db
    .prepare(
      `SELECT r.id, r.name, r.voting_deadline, s.status AS season_status, s.league_id AS league_id
       FROM rounds r JOIN seasons s ON s.id = r.season_id
       WHERE r.id = ?`,
    )
    .get(roundId) as CurrentRoundMeta | undefined;
  if (!round) throw error(404, 'Round not found');

  const roundsIndex = db
    .prepare(
      `SELECT r.id, r.name, r.voting_deadline,
              s.id AS season_id, s.season_number, s.status AS season_status,
              l.id AS league_id, l.name AS league_name
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       ORDER BY l.name ASC, s.season_number ASC, r.id ASC`,
    )
    .all() as RoundIndexEntry[];

  const currentRound: CurrentRoundMeta = {
    id: round.id,
    name: round.name ?? '',
    voting_deadline: round.voting_deadline,
    season_status: round.season_status,
    league_id: round.league_id,
  };

  const relContext = await fetchRelContext(fetch, round.league_id);

  const draft = getActiveDraftForRound(db, roundId);
  if (draft) {
    const sections = getSectionsForDraft(db, draft.id).map((s) => ({
      ...s,
      content: parseContent(s.content_json),
      variant: ((s as DigestSectionRow & { variant?: string }).variant ?? 'textual') as
        | 'textual'
        | 'visual'
        | 'both',
    }));
    const stage: 'refine' | 'finalize' = draft.finalized_at ? 'finalize' : 'refine';
    const [standings, stats, discoverability, nextRound] = await Promise.all([
      fetchStandings(fetch, roundId),
      fetchJson<{ stats: DigestStats }>(fetch, `/api/digest/${roundId}/stats`).then((b) => b?.stats ?? null),
      fetchJson<{ discoverability: TastemakerPayload | null }>(fetch, `/api/digest/${roundId}/discoverability`).then((b) => b?.discoverability ?? null),
      fetchJson<{ nextRound: NextRoundInfo | null }>(fetch, `/api/digest/${roundId}/next-round`).then((b) => b?.nextRound ?? null),
    ]);

    // sprint-21 season-recap: when the active draft was generated in recap mode,
    // reframe the DATA sections at season scope — season stat-strip totals, a
    // recap context for the standings/tastemaker headings, and DROP next-round.
    let recap: RecapContext | null = null;
    let statsOut = stats;
    let nextRoundOut = nextRound;
    if ((draft as DigestDraftRow & { recap_enabled?: number }).recap_enabled) {
      const season = gatherSeasonData(db, roundId);
      recap = {
        enabled: true,
        final: !!(draft as DigestDraftRow & { recap_final?: number }).recap_final,
        champion: season.context.champion?.name ?? null,
        throughRound: season.context.throughRound,
        totalRounds: season.context.totalRounds,
        seasonLabel: season.context.seasonLabel,
      };
      statsOut = {
        recap: true,
        songs: season.statStrip.songs,
        votes: season.statStrip.votes,
        rounds: season.statStrip.rounds,
        players: season.statStrip.players,
        biggestRoundVotes: season.statStrip.biggestRound?.totalVotes,
      };
      nextRoundOut = null; // next-round is irrelevant in a season recap
    }

    return {
      roundId, roundsIndex, currentRound, relContext, share, stage, draft, sections,
      standings, stats: statsOut, discoverability, nextRound: nextRoundOut, recap,
    } satisfies DigestPageData;
  }

  const res = await fetch(`/api/digest/${roundId}/prepare`, { method: 'POST' });
  if (!res.ok) throw error(res.status, `prepare failed (${res.status})`);
  const { checks } = (await res.json()) as { checks: PrepareCheck[] };
  return { roundId, roundsIndex, currentRound, relContext, share, stage: 'prepare', checks } satisfies DigestPageData;
};

async function fetchRelContext(
  fetcher: typeof fetch,
  leagueId: number,
): Promise<RelContextSnapshot | null> {
  try {
    const res = await fetcher(`/api/leagues/${leagueId}/rel-context`);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<RelContextSnapshot> & { context?: string };
    if (typeof body.context !== 'string') return null;
    return {
      leagueId: body.leagueId ?? leagueId,
      context: body.context ?? '',
      previousContext: body.previousContext ?? null,
      updatedAt: body.updatedAt ?? null,
      previousUpdatedAt: body.previousUpdatedAt ?? null,
      lastRoundId: body.lastRoundId ?? null,
    };
  } catch {
    return null;
  }
}

// Standings payload for the data-driven standings section. Lazily computed +
// persisted server-side on first access. Failure-isolated: a round without vote
// data (or any error) yields null and the section simply doesn't render.
async function fetchStandings(
  fetcher: typeof fetch,
  roundId: number,
): Promise<StandingsPayload | null> {
  try {
    const res = await fetcher(`/api/digest/${roundId}/standings`);
    if (!res.ok) return null;
    const body = (await res.json()) as StandingsPayload;
    if (!body || !Array.isArray(body.standings)) return null;
    return body;
  } catch {
    return null;
  }
}

// Generic failure-isolated GET → parsed JSON (null on any error). Used for the
// sprint-17 data-driven section payloads (stats / discoverability / next-round).
async function fetchJson<T>(fetcher: typeof fetch, url: string): Promise<T | null> {
  try {
    const res = await fetcher(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function parseContent(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return { body: json };
  }
}
