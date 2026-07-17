import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { renderDigestHtml } from '$lib/digest/export.js';
import { claimSend, releaseClaim } from '$lib/digest/sendLog.js';
import { resolveScheduledDigest } from '$lib/digest/schedule.js';

// POST /api/digest/:roundId/send-claim — take the send slot and render the share
// page. The claim is the duplicate guard, so it is taken BEFORE the render.
//   Returns: { claimed: false } when someone already holds it — the caller must
//            not send. { claimed: true, url } when the caller owns the send.
//
// A render failure releases the claim: nothing was sent, so retrying is safe.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const row = db
    .prepare(
      `SELECT s.league_id AS leagueId FROM rounds r
        JOIN seasons s ON s.id = r.season_id WHERE r.id = ?`,
    )
    .get(roundId) as { leagueId: number } | undefined;
  if (!row) throw error(404, `round not found: ${roundId}`);

  // Re-check eligibility here rather than trusting the caller's stale schedule:
  // the poll and the claim are minutes apart, and this endpoint is the last
  // point at which a season-final or un-finalized round can still be stopped.
  const decision = resolveScheduledDigest(db, row.leagueId, new Date().toISOString());
  if (decision.action !== 'send' || decision.roundId !== roundId) {
    return json({ claimed: false, reason: `round ${roundId} is not sendable: ${decision.reason}` });
  }

  if (!claimSend(db, roundId, row.leagueId, new Date().toISOString())) {
    return json({ claimed: false, reason: 'already claimed' });
  }

  try {
    const { url } = await renderDigestHtml(roundId);
    return json({ claimed: true, url });
  } catch (e) {
    releaseClaim(db, roundId);
    const msg = e instanceof Error ? e.message : String(e);
    throw error(502, `digest html export failed, claim released: ${msg}`);
  }
};
