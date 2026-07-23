import type Database from 'better-sqlite3';
import type { BudgetSource, VoteBudget } from './types.js';

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
