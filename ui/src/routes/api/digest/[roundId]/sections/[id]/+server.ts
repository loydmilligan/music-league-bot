import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

function loadSection(db: ReturnType<typeof getDb>, roundId: number, sectionId: string) {
  return db
    .prepare(
      `SELECT s.* FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ? AND d.round_id = ?`,
    )
    .get(sectionId, roundId) as Record<string, unknown> | undefined;
}

// PATCH /api/digest/:roundId/sections/:id — manual ops (state/position/content). Stubbed.
export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();
  const section = loadSection(db, roundId, sectionId);
  if (!section) throw error(404, `section not found: ${sectionId}`);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return json({ stub: true, sectionId, patch: body, section });
};

// DELETE /api/digest/:roundId/sections/:id — hard delete. Stubbed.
export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();
  const section = loadSection(db, roundId, sectionId);
  if (!section) throw error(404, `section not found: ${sectionId}`);

  return json({ stub: true, sectionId, deleted: false });
};
