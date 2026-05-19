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

export type DigestPageData =
  | { roundId: number; stage: 'prepare'; checks: PrepareCheck[] }
  | { roundId: number; stage: 'refine' | 'finalize'; draft: DigestDraftRow; sections: SectionWithContent[] };

export const load: PageServerLoad = async ({ params, fetch }) => {
  const roundId = Number(params.roundId);
  if (!Number.isFinite(roundId)) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, 'Round not found');

  const draft = getActiveDraftForRound(db, roundId);
  if (draft) {
    const sections = getSectionsForDraft(db, draft.id).map((s) => ({
      ...s,
      content: parseContent(s.content_json),
    }));
    const stage: 'refine' | 'finalize' = draft.finalized_at ? 'finalize' : 'refine';
    return { roundId, stage, draft, sections } satisfies DigestPageData;
  }

  const res = await fetch(`/api/digest/${roundId}/prepare`, { method: 'POST' });
  if (!res.ok) throw error(res.status, `prepare failed (${res.status})`);
  const { checks } = (await res.json()) as { checks: PrepareCheck[] };
  return { roundId, stage: 'prepare', checks } satisfies DigestPageData;
};

function parseContent(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return { body: json };
  }
}
