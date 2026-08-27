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
import type Database from 'better-sqlite3';
import { coerceTopSectionVisuals } from '$lib/digest/topSectionVariants.js';
import { getRoundInsights, type RoundInsights } from '$lib/db/roundInsights.js';
import { buildChatSection, recommendParts, chatSectionEnabledFor, type ChatSectionData, type PartRecommendation } from '$lib/digest/chatSection.js';
import { getChatSettings } from '$lib/chat/historyQuery.js';
import { getGuesserData, type GuesserData } from '$lib/db/guesserInsights.js';
import { guesserSectionEnabledFor } from '$lib/digest/guesserSection.js';
import { gatherStorylineEvidence } from '$lib/digest/storylineEvidence.js';
import { gatherPrepMaterial, type MaterialRow } from '$lib/digest/prepMaterial.js';

// Same base the content/b-side endpoints use — see api/content/leagues/+server.ts.
const B_SIDE_BASE = (process.env.PUBLIC_DIGEST_BASE_URL ?? 'https://digest.mattmariani.com').replace(
  /\/+$/,
  '',
);

/**
 * Absolute URL of a league's published b-side archive, or null when it has none.
 *
 * Absolute on purpose: this page is exported to static HTML and re-served from
 * the digest host, so a root-relative link to a bot-ui route (/content) 404s
 * there. Returning null lets the caller drop the Archive tab rather than render
 * a link that goes nowhere.
 */
function getArchiveUrl(db: Database.Database, leagueId: number): string | null {
  try {
    const row = db
      .prepare('SELECT slug FROM dashboard_sites WHERE league_id = ?')
      .get(leagueId) as { slug: string } | undefined;
    return row ? `${B_SIDE_BASE}/${row.slug}` : null;
  } catch {
    return null;
  }
}

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
  avatar_url?: string | null;   // avatar image URL (base or themed)
  initials?: string;            // deterministic initials fallback
  hue?: string;                 // deterministic hue for initials circle
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
  themeSource?: 'description' | 'name';
  submissionDeadline?: string | null;
  votingDeadline?: string | null;
  deadline?: string | null;
  submissionsSoFar?: number | null;
};
export type NextRoundMeta = {
  data: NextRoundInfo | null;
  excluded: boolean;
  hasOverride: boolean;
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
  // Absolute URL of this league's published b-side archive, or null when the
  // league has none yet. MUST be absolute: the digest is exported as static HTML
  // and re-served from the digest host, where a root-relative /content is a 404
  // (those routes only exist on bot-ui). Null hides the Archive tab entirely.
  archiveUrl: string | null;
  /** Rollout run in flight for this round, if any; null hides the strip entirely. */
  rolloutRun: { id: string; state: string; current_ep: number } | null;
};

export type DigestPageData =
  | (DigestPageBase & {
      stage: 'prepare';
      checks: PrepareCheck[];
      material: MaterialRow[];
    })
  | (DigestPageBase & {
      stage: 'refine' | 'finalize';
      draft: DigestDraftRow;
      sections: SectionWithContent[];
      standings: StandingsPayload | null;
      stats: DigestStats | null;
      insights: RoundInsights | null;
      discoverability: TastemakerPayload | null;
      nextRound: NextRoundInfo | null;
      nextRoundMeta: NextRoundMeta;
      /** Deterministic chat sub-section; null when the league has no linked group. */
      chatSection: ChatSectionData | null;
      chatRecommendations: PartRecommendation[];
      recap: RecapContext | null;
      /** "The Guesser" deterministic sub-section; null when the league hasn't opted in. */
      guesserData: GuesserData | null;
      guesserPosition: number;
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

  const archiveUrl = getArchiveUrl(db, round.league_id);

  const rolloutRun = db.prepare(
    `SELECT id, state, current_ep FROM rollout_runs WHERE round_id = ?`,
  ).get(roundId) as { id: string; state: string; current_ep: number } | undefined ?? null;

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
    // ── Carry the seed motif onto each storylines cast member ──────────────
    // The Regulars strip shows "name · motif" pills, but the LLM only writes
    // { name, headline, evidence } — motif lives on the seed. Re-derive it
    // deterministically from the same evidence gatherer the LLM wrote from and
    // join by normalized name. A missing match just omits the motif (graceful);
    // a failure here must never take the digest down.
    try {
      const storySec = sections.find((s) => s.kind === 'storylines' && s.state !== 'excluded');
      const storyContent = storySec?.content as
        | { title?: string; cast?: Array<{ name?: string; motif?: string }> }
        | undefined;
      const cast = storyContent?.cast;
      // The section is "The Regulars" now (CD redesign D4/§4.2) — its shell
      // eyebrow reads content.title, so retitle regardless of the LLM's label.
      if (storyContent && Array.isArray(cast)) storyContent.title = 'The Regulars';
      if (Array.isArray(cast) && cast.length) {
        // `evidence` is the seed list that fired this round, in the same order
        // it was fed to the LLM. Match name-first (handles seeds the LLM echoed
        // verbatim), then fall back to positional for any the LLM renamed — the
        // count is 0–2, so the ordering the prompt imposes is reliable.
        const evidence = gatherStorylineEvidence(db, roundId);
        const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const used = new Set<number>();
        for (const m of cast) {
          if (!m || typeof m.name !== 'string' || m.motif) continue;
          const nm = normName(m.name);
          const idx = evidence.findIndex(
            (e, i) =>
              !used.has(i) &&
              (normName(e.player) === nm ||
                normName(e.player).startsWith(nm) ||
                nm.startsWith(normName(e.player))),
          );
          if (idx >= 0) {
            m.motif = evidence[idx].motif;
            used.add(idx);
          }
        }
        cast.forEach((m, i) => {
          if (m && typeof m.name === 'string' && !m.motif && evidence[i] && !used.has(i)) {
            m.motif = evidence[i].motif;
            used.add(i);
          }
        });
      }
    } catch (err) {
      console.error('[digest] storylines motif enrich failed, continuing:', err);
    }

    const stage: 'refine' | 'finalize' = draft.finalized_at ? 'finalize' : 'refine';
    let statsContent: { title?: string; body?: string; phrase?: import('$lib/db/roundInsights.js').PhraseOfRound } = {};
    try { statsContent = JSON.parse(draft.stats_content_json ?? '{}'); } catch { /* use empty editable caption */ }
    let savedVisuals: unknown = [];
    try { savedVisuals = JSON.parse(draft.top_section_visuals ?? '[]'); } catch { /* use auto mode */ }
    // ── chat sub-section (deterministic; reads chat_messages, not an export) ──
    // Failing to build it must never take the whole digest down: chat is a
    // bonus surface, and the group may not even be linked to this league.
    let chatSection: ChatSectionData | null = null;
    let chatRecommendations: PartRecommendation[] = [];
    try {
      const league = db
        .prepare('SELECT slug FROM leagues WHERE id = ?')
        .get(round.league_id) as { slug?: string } | undefined;
      const groupName = league?.slug
        ? (getChatSettings(db).leagueGroupMap[league.slug] ?? '')
        : '';
      // Per-league opt-in: a league only gets the section once its roster has
      // been linked in /settings/setup and someone has eyeballed the result.
      const enabled = league?.slug ? chatSectionEnabledFor(db, league.slug) : false;
      if (groupName && enabled) {
        const rawPlatform = (db
          .prepare('SELECT platform FROM chat_messages WHERE group_name = ? LIMIT 1')
          .get(groupName) as { platform?: string } | undefined)?.platform;
        const platform =
          rawPlatform === 'googlechat' ? ('google-chat' as const)
          : rawPlatform === 'discord' ? ('discord' as const)
          : ('whatsapp' as const);
        const nums = db
          .prepare(
            `SELECT r.id, r.round_number, r.voting_deadline
               FROM rounds r JOIN seasons s ON s.id = r.season_id
              WHERE s.id = (SELECT season_id FROM rounds WHERE id = ?)
              ORDER BY COALESCE(r.round_number, r.id) ASC`,
          )
          .all(roundId) as { id: number; round_number: number | null; voting_deadline: string | null }[];
        const idx = nums.findIndex((r) => r.id === roundId);
        const prevEnd = idx > 0 ? nums[idx - 1].voting_deadline : null;
        const roundNumber = nums[idx]?.round_number ?? idx + 1;

        chatSection = buildChatSection(db, {
          groupName,
          leagueId: round.league_id,
          platform,
          roundNumber,
          roundEndIso: round.voting_deadline,
          previousRoundEndIso: prevEnd,
        });

        if (chatSection) {
          // Last round's section is what "shown recently" means for the
          // repeat-winner check.
          const prior =
            idx > 0
              ? buildChatSection(db, {
                  groupName,
                  leagueId: round.league_id,
                  platform,
                  roundNumber: roundNumber - 1,
                  roundEndIso: nums[idx - 1].voting_deadline,
                  previousRoundEndIso: idx > 1 ? nums[idx - 2].voting_deadline : null,
                })
              : null;
          const hasLinerNotes = sections.some(
            (sec) => sec.kind === 'chat' && sec.state !== 'excluded',
          );
          chatRecommendations = recommendParts(chatSection, prior, hasLinerNotes);
        }
      }
    } catch (err) {
      console.error('[digest] chat section failed, continuing without it:', err);
    }

    // ── "The Guesser" sub-section (deterministic; scores vote-comment guesses) ──
    // Opt-in per league, same convention as chat: off unless explicitly enabled
    // in settings. Never let a failure here take down the digest.
    let guesserData: GuesserData | null = null;
    try {
      const slug = (db
        .prepare('SELECT slug FROM leagues WHERE id = ?')
        .get(round.league_id) as { slug?: string } | undefined)?.slug;
      if (slug && guesserSectionEnabledFor(db, slug)) guesserData = getGuesserData(db, roundId);
    } catch (err) {
      console.error('[digest] guesser section failed, continuing without it:', err);
    }
    const guesserPosition = (draft as DigestDraftRow & { guesser_position?: number }).guesser_position ?? 0;

    const insights = { ...getRoundInsights(db, roundId), roundId, topSectionVariant: draft.top_section_variant, topSectionVisuals: coerceTopSectionVisuals(savedVisuals), statsContent };
    const [standings, stats, discoverability, nextRoundRaw] = await Promise.all([
      fetchStandings(fetch, roundId),
      fetchJson<{ stats: DigestStats }>(fetch, `/api/digest/${roundId}/stats`).then((b) => b?.stats ?? null),
      fetchJson<{ discoverability: TastemakerPayload | null }>(fetch, `/api/digest/${roundId}/discoverability`).then((b) => b?.discoverability ?? null),
      fetchJson<{ nextRound: NextRoundInfo | null; excluded?: boolean; hasOverride?: boolean }>(fetch, `/api/digest/${roundId}/next-round`),
    ]);
    const nextRound = nextRoundRaw?.nextRound ?? null;
    const nextRoundMeta: NextRoundMeta = {
      data: nextRound,
      excluded: !!(nextRoundRaw?.excluded),
      hasOverride: !!(nextRoundRaw?.hasOverride),
    };

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

    const nextRoundMetaOut: NextRoundMeta = nextRoundOut === null
      ? { data: null, excluded: nextRoundMeta.excluded, hasOverride: false }
      : nextRoundMeta;

    return {
      roundId, roundsIndex, currentRound, relContext, share, archiveUrl, rolloutRun, stage, draft, sections,
      standings, stats: statsOut, insights, discoverability, chatSection, chatRecommendations, nextRound: nextRoundOut, nextRoundMeta: nextRoundMetaOut, recap,
      guesserData, guesserPosition,
    } satisfies DigestPageData;
  }

  const res = await fetch(`/api/digest/${roundId}/prepare`, { method: 'POST' });
  if (!res.ok) throw error(res.status, `prepare failed (${res.status})`);
  const { checks } = (await res.json()) as { checks: PrepareCheck[] };
  const material = gatherPrepMaterial(getDb(), roundId);
  return { roundId, roundsIndex, currentRound, relContext, share, archiveUrl, rolloutRun, stage: 'prepare', checks, material } satisfies DigestPageData;
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
