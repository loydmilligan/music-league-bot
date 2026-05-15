import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getLeagueBySlug } from '$lib/db/leagues.js';
import { getRoundsForSeason, updateDeadlines } from '$lib/db/rounds.js';
import { computeDeadlines } from '$lib/deadlines.js';

interface Body {
  league: string;
  season: number;
  daysToSubmit: number;
  daysToVote: number;
  startDate: string;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Partial<Body>;
  const league = typeof body.league === 'string' ? body.league.trim() : '';
  const season = Number(body.season);
  const daysToSubmit = Number(body.daysToSubmit);
  const daysToVote = Number(body.daysToVote);
  const startDate = typeof body.startDate === 'string' ? body.startDate : '';

  if (!league || !Number.isFinite(season) || season <= 0
      || !Number.isFinite(daysToSubmit) || daysToSubmit <= 0
      || !Number.isFinite(daysToVote) || daysToVote <= 0
      || !startDate) {
    throw error(400, 'league, season, daysToSubmit, daysToVote, startDate all required (positive numbers; startDate ISO)');
  }
  if (Number.isNaN(new Date(startDate).getTime())) {
    throw error(400, `invalid startDate: ${startDate}`);
  }

  const db = getDb();
  const leagueRow = getLeagueBySlug(db, league);
  if (!leagueRow) throw error(404, `league not found: ${league}`);

  const seasonRow = db.prepare(
    'SELECT id FROM seasons WHERE league_id = ? AND season_number = ?'
  ).get(leagueRow.id, season) as { id: number } | undefined;
  if (!seasonRow) throw error(404, `season not found: ${league} / season ${season}`);

  const rounds = getRoundsForSeason(db, seasonRow.id); // ordered by created_at
  if (rounds.length === 0) {
    return json({ updated: 0, rounds: [] });
  }

  let computed;
  try {
    computed = computeDeadlines(rounds.length, { daysToSubmit, daysToVote, startDate });
  } catch (e: any) {
    throw error(400, e?.message ?? 'failed to compute deadlines');
  }

  // Round 1 is the earliest by created_at; back-to-back voting → next submission.
  const tx = db.transaction(() => {
    for (let i = 0; i < rounds.length; i++) {
      updateDeadlines(db, rounds[i].id, computed[i].submissionDeadline, computed[i].votingDeadline);
    }
  });
  tx();

  return json({
    updated: rounds.length,
    rounds: rounds.map((r, i) => ({
      id: r.id,
      submission_deadline: computed[i].submissionDeadline,
      voting_deadline: computed[i].votingDeadline,
    })),
  });
};
