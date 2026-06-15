import { getDb } from '$lib/db/client.js';
import { getContentPendingCount } from '$lib/db/layout.js';
import type { PageServerLoad } from './$types.js';

export type ContentLeague = {
  id: number;
  slug: string;
  name: string;
  members: number;
  bside: {
    slug: string;
    url: string;
    season: number;
    archivedCount: number;
    lastUpdated: string;
  } | null;
  pending: {
    roundId: number;
    theme: string;
    winnerSong: string;
    winnerArtist: string;
    submitter: string;
    votes: number;
    closedAt: string | null;
  } | null;
};

export interface ContentPageData {
  pendingCount: number;
  latestDigestRoundId: number | null;
  leagues: ContentLeague[];
}

export const load: PageServerLoad = async ({ fetch }): Promise<ContentPageData> => {
  const db = getDb();

  const pendingCount = getContentPendingCount(db);

  // Most recent digest round — used for the Digest tab link
  const unfinalized = db
    .prepare(
      `SELECT round_id FROM digest_drafts
       WHERE finalized_at IS NULL
       ORDER BY generated_at DESC LIMIT 1`,
    )
    .get() as { round_id: number } | undefined;

  let latestDigestRoundId: number | null = null;
  if (unfinalized) {
    latestDigestRoundId = unfinalized.round_id;
  } else {
    const latest = db
      .prepare(
        `SELECT r.id FROM rounds r
         WHERE EXISTS (SELECT 1 FROM votes WHERE round_id = r.id)
         ORDER BY r.id DESC LIMIT 1`,
      )
      .get() as { id: number } | undefined;
    latestDigestRoundId = latest?.id ?? null;
  }

  const res = await fetch('/api/content/leagues');
  const leagues: ContentLeague[] = await res.json();

  return { pendingCount, latestDigestRoundId, leagues };
};
