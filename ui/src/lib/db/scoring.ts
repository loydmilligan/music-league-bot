/**
 * scoring — the two rules every points query has to obey.
 *
 * Both of these were missing everywhere, and both were found the same way: the
 * app's season standings disagreed with Music League's own board for a whole
 * league. Applying the pair below reproduces the official totals exactly.
 *
 * They live here rather than in `standings.ts` because the digest draft path
 * (`seasonData.ts`) scores songs independently of the standings path, so a rule
 * written in only one of them silently disagrees with the other.
 */

import type Database from 'better-sqlite3';

/**
 * The no-vote penalty, as a SQL expression over a `ml_submissions m LEFT JOIN
 * votes v` group.
 *
 * If a submitter never files a ballot, the upvotes their song received are
 * voided and the downvotes stand. This is Music League's own behaviour — the
 * site shows the raw total struck through next to the penalised one — not a
 * per-league house rule, so it is applied everywhere. Precedents are recorded
 * in the rulecards: Boarz R147 (Grant Koziol, 5 up/−5 down → −5), Second Best
 * R139 (Joe Quinto, 13 upvote points voided → −1), Fam-Jam R127 (Ari, 4 → 0).
 *
 * "Filed a ballot" means the voter has ANY row in `votes` for that round,
 * including a zero-point comment-only row — that is what the export writes for
 * someone who voted but spent nothing on a given song.
 *
 * Callers must group by submission and keep `m.round_id` / `m.competitor_id` in
 * scope; the correlated EXISTS is per-round, so it stays correct when the query
 * spans several rounds at once.
 */
export const SCORED_POINTS_SQL = `CASE WHEN EXISTS (
        SELECT 1 FROM votes bal
        WHERE bal.round_id = m.round_id AND bal.voter_id = m.competitor_id
      )
      THEN COALESCE(SUM(v.points), 0)
      ELSE COALESCE(SUM(CASE WHEN v.points < 0 THEN v.points ELSE 0 END), 0)
    END`;

/**
 * Round ids for a season in the order they were actually played.
 *
 * `ORDER BY id` is wrong: ids are assigned at import, not at play time. In
 * Boarz season 10 the true order is 135, 145…149, 153, 150, 151 — R153
 * "Stranger Danger" closed on 2026-09-03, a week before R150, but sorts last by
 * id. Anything that slices "rounds up to N" by id therefore dropped R153 out of
 * every standing computed for R150 or R151.
 *
 * Deadlines can be null (rounds imported from a zip carry no voting_deadline),
 * so the sort falls back through submission_deadline to created_at, and finally
 * to id so the order is always total and stable.
 */
export function seasonRoundIdsInPlayOrder(db: Database.Database, seasonId: number): number[] {
	return (
		db
			.prepare(
				`SELECT id FROM rounds WHERE season_id = ?
         ORDER BY COALESCE(voting_deadline, submission_deadline, created_at), id`,
			)
			.all(seasonId) as { id: number }[]
	).map((r) => r.id);
}
