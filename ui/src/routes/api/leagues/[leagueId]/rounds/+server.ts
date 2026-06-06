import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { createRoundWithDeadlines, getLeagueActiveRound } from '$lib/db/activeRound.js';

interface CreateBody {
  name?: string;
  theme?: string | null;
  submission_deadline?: string | null;
  voting_deadline?: string | null;
  set_active?: boolean;
}

function isIsoDateOrNull(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== 'string' || v.trim() === '') return false;
  return !Number.isNaN(Date.parse(v));
}

// POST /api/leagues/:leagueId/rounds — create a round (with deadlines) under the
// league's active season. Body: { name, theme?, submission_deadline?,
// voting_deadline?, set_active? }. Returns { round, league } where league is the
// refreshed active-round view.
export const POST: RequestHandler = async ({ params, request }) => {
  const leagueId = Number(params.leagueId);
  if (!leagueId) throw error(400, 'invalid leagueId');

  const db = getDb();
  const league = db.prepare('SELECT id FROM leagues WHERE id = ?').get(leagueId);
  if (!league) throw error(404, `league not found: ${leagueId}`);

  const body = (await request.json().catch(() => ({}))) as Partial<CreateBody>;

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    throw error(400, 'name must be a non-empty string');
  }
  if (body.theme !== undefined && body.theme !== null && typeof body.theme !== 'string') {
    throw error(400, 'theme must be a string or null');
  }
  if (body.submission_deadline !== undefined && !isIsoDateOrNull(body.submission_deadline)) {
    throw error(400, 'submission_deadline must be an ISO date string or null');
  }
  if (body.voting_deadline !== undefined && !isIsoDateOrNull(body.voting_deadline)) {
    throw error(400, 'voting_deadline must be an ISO date string or null');
  }
  const sub = body.submission_deadline ?? null;
  const vote = body.voting_deadline ?? null;
  if (sub && vote && Date.parse(vote) <= Date.parse(sub)) {
    throw error(400, 'voting_deadline must be after submission_deadline');
  }

  let created: { roundId: number; seasonId: number };
  try {
    created = createRoundWithDeadlines(db, leagueId, {
      name: body.name.trim(),
      theme: body.theme ?? null,
      submissionDeadline: sub,
      votingDeadline: vote,
      setActive: body.set_active === true,
    });
  } catch (e) {
    throw error(409, e instanceof Error ? e.message : 'failed to create round');
  }

  return json(
    { round: created, league: getLeagueActiveRound(db, leagueId) },
    { status: 201 },
  );
};
