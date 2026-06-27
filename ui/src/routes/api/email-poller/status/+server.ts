import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getEmailPollerData } from '$lib/email/emailPollerQuery.js';

/**
 * GET /api/email-poller/status
 *
 * Latest poll status + the 10 most recent ingested emails with their action
 * outcomes. Backs the Settings → Email ingestion panel's manual refresh.
 */
export const GET: RequestHandler = async () => {
  return json(getEmailPollerData(getDb()));
};
