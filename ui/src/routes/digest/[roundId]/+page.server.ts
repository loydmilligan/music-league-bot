import type { PageServerLoad } from './$types.js';
import { error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  getActiveDraftForRound,
  getSectionsForDraft,
  type DigestDraftRow,
  type DigestSectionRow,
} from '$lib/digest/llm.js';

export type PrepareCheck = {
  name: string;
  ok: boolean;
  src: string;
  count?: number;
  optional?: boolean;
};

export type SectionWithContent = DigestSectionRow & { content: unknown };

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
};

type DigestPageBase = {
  roundId: number;
  roundsIndex: RoundIndexEntry[];
  currentRound: CurrentRoundMeta;
};

export type DigestPageData =
  | (DigestPageBase & { stage: 'prepare'; checks: PrepareCheck[] })
  | (DigestPageBase & { stage: 'refine' | 'finalize'; draft: DigestDraftRow; sections: SectionWithContent[] });

export const load: PageServerLoad = async ({ params, fetch }) => {
  const roundId = Number(params.roundId);
  if (!Number.isFinite(roundId)) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db
    .prepare(
      `SELECT r.id, r.name, r.voting_deadline, s.status AS season_status
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
  };

  const draft = getActiveDraftForRound(db, roundId);
  if (draft) {
    const sections = getSectionsForDraft(db, draft.id).map((s) => ({
      ...s,
      content: parseContent(s.content_json),
    }));
    const stage: 'refine' | 'finalize' = draft.finalized_at ? 'finalize' : 'refine';
    return { roundId, roundsIndex, currentRound, stage, draft, sections } satisfies DigestPageData;
  }

  const res = await fetch(`/api/digest/${roundId}/prepare`, { method: 'POST' });
  if (!res.ok) throw error(res.status, `prepare failed (${res.status})`);
  const { checks } = (await res.json()) as { checks: PrepareCheck[] };
  return { roundId, roundsIndex, currentRound, stage: 'prepare', checks } satisfies DigestPageData;
};

function parseContent(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return { body: json };
  }
}
