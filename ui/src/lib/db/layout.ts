import { statSync } from 'node:fs';
import type Database from 'better-sqlite3';

export type LeagueRailStatus = 'active' | 'voting' | 'open' | 'idle';

export interface LeagueRailEntry {
  slug: string;
  name: string;
  status: LeagueRailStatus;
  currentRoundId: number | null;
  currentRoundLabel: string | null;
}

export interface CrossLeagueUpcoming {
  leagueSlug: string;
  roundName: string;
  phase: 'submissions' | 'voting';
  deadline: string;
}

function deriveStatus(
  hasActiveSeason: boolean,
  submissionDeadline: string | null,
  votingDeadline: string | null,
  now: number,
): LeagueRailStatus {
  if (!hasActiveSeason) return 'idle';
  const subMs = submissionDeadline ? Date.parse(submissionDeadline) : NaN;
  const voteMs = votingDeadline ? Date.parse(votingDeadline) : NaN;
  const subOpen = Number.isFinite(subMs) && subMs > now;
  const voteOpen = Number.isFinite(voteMs) && voteMs > now;
  if (subOpen) return 'active';
  if (voteOpen) return 'voting';
  // active season exists but the current round has no future deadlines:
  // treat as "open" (the season is live but no countdown is running yet).
  return 'open';
}

export function getAllAdoptedLeagues(db: Database.Database, now = Date.now()): LeagueRailEntry[] {
  // Pull each league plus its most-recent round in the most-recent active
  // season (if any). Single query so the rail load stays cheap on every nav.
  const rows = db.prepare(`
    SELECT
      l.slug,
      l.name,
      (SELECT s.id FROM seasons s WHERE s.league_id = l.id AND s.status = 'active'
         ORDER BY s.season_number DESC LIMIT 1) AS active_season_id
    FROM leagues l
    WHERE l.exclude_from_combined = 0
    ORDER BY l.id
  `).all() as { slug: string; name: string; active_season_id: number | null }[];

  const roundStmt = db.prepare(`
    SELECT id, name, submission_deadline, voting_deadline
    FROM rounds WHERE season_id = ?
    ORDER BY created_at DESC LIMIT 1
  `);

  return rows.map(r => {
    const round = r.active_season_id
      ? (roundStmt.get(r.active_season_id) as {
          id: number; name: string;
          submission_deadline: string | null;
          voting_deadline: string | null;
        } | undefined)
      : undefined;
    return {
      slug: r.slug,
      name: r.name,
      status: deriveStatus(
        r.active_season_id !== null,
        round?.submission_deadline ?? null,
        round?.voting_deadline ?? null,
        now,
      ),
      currentRoundId: round?.id ?? null,
      currentRoundLabel: round?.name ?? null,
    };
  });
}

export function getCrossLeagueUpcoming(db: Database.Database, now = Date.now()): CrossLeagueUpcoming[] {
  // Every round (across non-excluded leagues) with a deadline still in the
  // future, expanded into one entry per phase.
  const rows = db.prepare(`
    SELECT l.slug AS league_slug, r.name AS round_name,
           r.submission_deadline, r.voting_deadline
    FROM rounds r
    JOIN seasons s ON s.id = r.season_id
    JOIN leagues l ON l.id = s.league_id
    WHERE l.exclude_from_combined = 0
      AND (r.submission_deadline IS NOT NULL OR r.voting_deadline IS NOT NULL)
  `).all() as {
    league_slug: string; round_name: string;
    submission_deadline: string | null;
    voting_deadline: string | null;
  }[];

  const out: CrossLeagueUpcoming[] = [];
  for (const r of rows) {
    if (r.submission_deadline && Date.parse(r.submission_deadline) > now) {
      out.push({ leagueSlug: r.league_slug, roundName: r.round_name, phase: 'submissions', deadline: r.submission_deadline });
    }
    if (r.voting_deadline && Date.parse(r.voting_deadline) > now) {
      out.push({ leagueSlug: r.league_slug, roundName: r.round_name, phase: 'voting', deadline: r.voting_deadline });
    }
  }
  out.sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
  return out;
}

export interface WatcherDiagnostics {
  uptimeMs: number;
  dbSizeBytes: number;
  lastPollAt: string | null;
}

export function getWatcherDiagnostics(
  db: Database.Database,
  dbFilePath: string,
): WatcherDiagnostics {
  let dbSizeBytes = 0;
  try { dbSizeBytes = statSync(dbFilePath).size; } catch { /* file may not exist yet */ }
  const lastPoll = db.prepare(
    'SELECT imported_at FROM import_log ORDER BY imported_at DESC LIMIT 1'
  ).get() as { imported_at: string } | undefined;
  return {
    uptimeMs: Math.round(process.uptime() * 1000),
    dbSizeBytes,
    lastPollAt: lastPoll?.imported_at ?? null,
  };
}
