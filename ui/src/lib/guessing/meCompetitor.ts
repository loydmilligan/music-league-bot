import type Database from 'better-sqlite3';

/**
 * Which `competitors` row is Matt, per league.
 *
 * Project A takes `mePlayerId` as a parameter everywhere and deliberately left
 * this unanswered. Nothing else in the app knows: `voting_lab_ballot.is_mine` is
 * per-song and manual, and `settings.chat_self_names` holds a chat display name
 * that does not match the competitor name.
 *
 * Per league, because Matt is a different competitors row in each. Stored in
 * `settings` rather than as a `leagues` column because client.ts only ever runs
 * CREATE TABLE IF NOT EXISTS and must never alter a live table.
 */
const KEY = (leagueSlug: string): string => `guess_me_competitor:${leagueSlug}`;

export function getMeCompetitorId(db: Database.Database, leagueSlug: string): number | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY(leagueSlug)) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isInteger(n) ? n : null;
}

export function setMeCompetitorId(
  db: Database.Database,
  leagueSlug: string,
  competitorId: number,
): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY(leagueSlug), String(competitorId));
}

/** Convenience for the API routes, which know a round rather than a league. */
export function resolveMeForRound(db: Database.Database, roundId: number): number | null {
  const row = db.prepare(
    `SELECT l.slug AS slug
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
      WHERE r.id = ?`,
  ).get(roundId) as { slug: string } | undefined;
  return row ? getMeCompetitorId(db, row.slug) : null;
}
