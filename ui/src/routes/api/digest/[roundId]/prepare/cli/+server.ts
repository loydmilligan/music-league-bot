import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';

// POST /api/digest/:roundId/prepare/cli — v2 stub (cli-web-musicleague auto-fetch).
// Disabled in v1 per sprint-9 D4. Returns 501 so the UI can render the ghost CTA.
export const POST: RequestHandler = async () => {
  return json(
    { ok: false, disabled: true, reason: 'v2 — use export.zip upload (v1 CTA)' },
    { status: 501 },
  );
};
