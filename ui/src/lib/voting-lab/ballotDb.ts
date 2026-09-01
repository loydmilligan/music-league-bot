import type Database from 'better-sqlite3';
import type { BudgetSource, VoteBudget, BallotEntry } from './types.js';

/** Used only when neither a round override nor a season default exists. */
export const DEFAULT_BUDGET: VoteBudget = { upTotal: 7, downTotal: 1, perSongCap: null };

type BudgetRow = { up_total: number; down_total: number; per_song_cap: number | null };

function toBudget(row: BudgetRow): VoteBudget {
  return { upTotal: row.up_total, downTotal: row.down_total, perSongCap: row.per_song_cap };
}

export function getSeasonBudget(db: Database.Database, seasonId: number): VoteBudget | null {
  const row = db.prepare(
    `SELECT up_total, down_total, per_song_cap FROM season_vote_budget WHERE season_id = ?`,
  ).get(seasonId) as BudgetRow | undefined;
  return row ? toBudget(row) : null;
}

export function setSeasonBudget(db: Database.Database, seasonId: number, budget: VoteBudget): void {
  db.prepare(
    `INSERT INTO season_vote_budget (season_id, up_total, down_total, per_song_cap, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(season_id) DO UPDATE SET
       up_total = excluded.up_total,
       down_total = excluded.down_total,
       per_song_cap = excluded.per_song_cap,
       updated_at = excluded.updated_at`,
  ).run(seasonId, budget.upTotal, budget.downTotal, budget.perSongCap, new Date().toISOString());
}

export function setRoundBudget(db: Database.Database, roundId: number, budget: VoteBudget): void {
  db.prepare(
    `INSERT INTO voting_lab_budget (round_id, up_total, down_total, per_song_cap, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(round_id) DO UPDATE SET
       up_total = excluded.up_total,
       down_total = excluded.down_total,
       per_song_cap = excluded.per_song_cap,
       updated_at = excluded.updated_at`,
  ).run(roundId, budget.upTotal, budget.downTotal, budget.perSongCap, new Date().toISOString());
}

/**
 * Round override -> season default -> hardcoded default.
 * `source` tells the UI which level it is showing so it can label it.
 */
export function resolveBudget(
  db: Database.Database,
  roundId: number,
): { budget: VoteBudget; source: BudgetSource } {
  const roundRow = db.prepare(
    `SELECT up_total, down_total, per_song_cap FROM voting_lab_budget WHERE round_id = ?`,
  ).get(roundId) as BudgetRow | undefined;
  if (roundRow) return { budget: toBudget(roundRow), source: 'round' };

  const seasonRow = db.prepare(
    `SELECT b.up_total, b.down_total, b.per_song_cap
     FROM rounds r
     JOIN season_vote_budget b ON b.season_id = r.season_id
     WHERE r.id = ?`,
  ).get(roundId) as BudgetRow | undefined;
  if (seasonRow) return { budget: toBudget(seasonRow), source: 'season' };

  return { budget: DEFAULT_BUDGET, source: 'default' };
}

type BallotRow = {
  spotify_uri: string; up_points: number; down_points: number;
  rating: number | null; notes: string; draft_comment: string; is_mine: number;
};

export function getBallot(db: Database.Database, roundId: number): BallotEntry[] {
  const rows = db.prepare(
    `SELECT spotify_uri, up_points, down_points, rating, notes, draft_comment, is_mine
     FROM voting_lab_ballot WHERE round_id = ? ORDER BY spotify_uri`,
  ).all(roundId) as BallotRow[];
  return rows.map((r) => ({
    spotifyUri: r.spotify_uri,
    upPoints: r.up_points,
    downPoints: r.down_points,
    rating: r.rating,
    notes: r.notes,
    draftComment: r.draft_comment,
    isMine: r.is_mine === 1,
  }));
}

/**
 * The ONLY writer of `is_mine` — the guess workspace's mark-first control
 * (spec §6, §4a). `saveBallotEntry` deliberately does not touch the column, so
 * the ballot client's whole-row upsert can never carry a stale flag back in.
 *
 * Marking a song also zeroes its `up_points`/`down_points`. This is inherited
 * from the semantics of the control this replaced: the old Voting Lab toggle
 * cleared points when marking, because a song marked as yours renders without
 * steppers, `validateBallot` permanently rejects any points on it, and
 * `computeUsage` would keep charging them against the budget with no UI left to
 * reclaim them. The clear path does NOT restore or zero anything — unmarking
 * only lifts the flag.
 *
 * Exclusive by construction: exactly one song per round may be the owner's, and
 * `assignment.ts:eligibleSongs` excludes every `is_mine=1` song — two marked
 * songs would silently shrink the slate. Pass `null` to clear the round.
 *
 * Wrapped in a transaction so a round can never be observed with two marked
 * songs, or with none when one was intended.
 */
export function setIsMine(
  db: Database.Database,
  roundId: number,
  spotifyUri: string | null,
): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE voting_lab_ballot SET is_mine = 0, updated_at = ?
        WHERE round_id = ? AND is_mine = 1`,
    ).run(now, roundId);

    if (spotifyUri === null) return;

    db.prepare(
      `INSERT INTO voting_lab_ballot (round_id, spotify_uri, is_mine, up_points, down_points, updated_at)
       VALUES (?, ?, 1, 0, 0, ?)
       ON CONFLICT(round_id, spotify_uri) DO UPDATE SET
         is_mine = 1,
         up_points = 0,
         down_points = 0,
         updated_at = excluded.updated_at`,
    ).run(roundId, spotifyUri, now);
  })();
}

/**
 * Whole-row ballot upsert — every column EXCEPT `is_mine`, which only
 * `setIsMine` writes.
 *
 * `entry.isMine` is accepted and ignored on purpose. The Voting Lab loads its
 * ballot snapshot once at mount and re-sends the whole entry on every edit, so
 * a stale flag rides along with every notes/points/rating change; honouring it
 * would silently unmark the owner's song (making the guess slate unsatisfiable)
 * or leave two songs marked (silently shrinking it), and would bypass the
 * gut-lock gate on /api/guess/[roundId]/mine. The schema default
 * (`is_mine INTEGER NOT NULL DEFAULT 0`) covers the insert case.
 */
export function saveBallotEntry(db: Database.Database, roundId: number, entry: BallotEntry): void {
  db.prepare(
    `INSERT INTO voting_lab_ballot
       (round_id, spotify_uri, up_points, down_points, rating, notes, draft_comment, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round_id, spotify_uri) DO UPDATE SET
       up_points = excluded.up_points,
       down_points = excluded.down_points,
       rating = excluded.rating,
       notes = excluded.notes,
       draft_comment = excluded.draft_comment,
       updated_at = excluded.updated_at`,
  ).run(
    roundId, entry.spotifyUri, entry.upPoints, entry.downPoints,
    entry.rating, entry.notes, entry.draftComment,
    new Date().toISOString(),
  );
}
