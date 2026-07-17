import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { buildSchedule } from '$lib/digest/schedule.js';

// GET /api/digest/schedule — what the auto-poster should do for every league now.
// Polled by the bot container, which owns the WhatsApp client and cannot import
// $lib. Read-only: deciding is not doing.
//   Returns: { now, entries: [{ leagueId, leagueSlug, action, roundId, roundName, reason }] }
export const GET: RequestHandler = async () => {
  const now = new Date().toISOString();
  return json({ now, entries: buildSchedule(getDb(), now) });
};
