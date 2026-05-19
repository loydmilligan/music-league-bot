import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async () => {
  const db = getDb();

  // Find the most recent unfinalized draft's round first
  const unfinalized = db
    .prepare(
      `SELECT round_id FROM digest_drafts
       WHERE finalized_at IS NULL
       ORDER BY generated_at DESC LIMIT 1`,
    )
    .get() as { round_id: number } | undefined;

  if (unfinalized) {
    throw redirect(302, `/digest/${unfinalized.round_id}`);
  }

  // Fall back to the most recent closed round (has votes)
  const latest = db
    .prepare(
      `SELECT r.id FROM rounds r
       WHERE EXISTS (SELECT 1 FROM votes WHERE round_id = r.id)
       ORDER BY r.id DESC LIMIT 1`,
    )
    .get() as { id: number } | undefined;

  if (latest) {
    throw redirect(302, `/digest/${latest.id}`);
  }

  // No rounds at all — redirect to settings
  throw redirect(302, '/settings');
};
