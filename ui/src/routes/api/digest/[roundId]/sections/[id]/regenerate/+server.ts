import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// POST /api/digest/:roundId/sections/:id/regenerate — per-section regen. Stubbed.
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();
  const section = db
    .prepare(
      `SELECT s.* FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ? AND d.round_id = ?`,
    )
    .get(sectionId, roundId);
  if (!section) throw error(404, `section not found: ${sectionId}`);

  const body = (await request.json().catch(() => ({}))) as {
    chips?: string[];
    instructions?: string;
  };
  return json({ stub: true, sectionId, chips: body.chips ?? [], instructions: body.instructions ?? '', section });
};
