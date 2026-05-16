import { statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getRoundPhase, seasonIsActive, type RoundPhase } from '../lifecycle.js';

export type LeagueRailStatus = 'active' | 'voting' | 'open' | 'idle';

export interface LeagueRailEntry {
  slug: string;
  name: string;
  status: LeagueRailStatus;
  currentRoundId: number | null;
  currentRoundLabel: string | null;
  currentRoundPhase: RoundPhase | null;
}

export interface CrossLeagueUpcoming {
  leagueSlug: string;
  roundName: string;
  phase: 'submissions' | 'voting';
  deadline: string;
}

interface RoundDbRow {
  id: number;
  name: string;
  submission_deadline: string | null;
  voting_deadline: string | null;
  created_at: string;
}

/**
 * "Current" round for the rail label: prefer a round in submission, then
 * voting, then upcoming, then the most recent archived. Mirrors how a user
 * mentally tracks "where the season is right now."
 */
function pickCurrentRound(
  rounds: RoundDbRow[],
  now: number,
): { round: RoundDbRow; phase: RoundPhase } | null {
  if (rounds.length === 0) return null;
  const withPhase = rounds.map(r => ({ round: r, phase: getRoundPhase(r, now) }));
  const priority: Record<RoundPhase, number> = { submission: 0, voting: 1, upcoming: 2, archive: 3 };
  withPhase.sort((a, b) => {
    if (priority[a.phase] !== priority[b.phase]) return priority[a.phase] - priority[b.phase];
    // within the same phase: latest created_at wins
    return Date.parse(b.round.created_at) - Date.parse(a.round.created_at);
  });
  return withPhase[0];
}

function deriveRailStatus(currentPhase: RoundPhase | null): LeagueRailStatus {
  switch (currentPhase) {
    case 'submission': return 'active';
    case 'voting':     return 'voting';
    case 'upcoming':   return 'open';
    case 'archive':
    case null:
    default:           return 'idle';
  }
}

export function getAllAdoptedLeagues(db: Database.Database, now = Date.now()): LeagueRailEntry[] {
  // Pull every league with its most-recent active-status season id.
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

  const roundsStmt = db.prepare(`
    SELECT id, name, submission_deadline, voting_deadline, created_at
    FROM rounds WHERE season_id = ?
    ORDER BY created_at ASC
  `);

  return rows.map(r => {
    const rounds = r.active_season_id ? (roundsStmt.all(r.active_season_id) as RoundDbRow[]) : [];
    const phased = rounds.map(round => ({ ...round, phase: getRoundPhase(round, now) }));
    // The season is "active" in DB terms because status='active'; the rail
    // status reflects whether any round is actually open right now.
    const seasonOpen = seasonIsActive({ rounds: phased });
    const current = pickCurrentRound(rounds, now);
    const phase = current?.phase ?? null;
    const status: LeagueRailStatus = seasonOpen
      ? deriveRailStatus(phase)
      : phase === 'upcoming'
        ? 'open'
        : 'idle';
    return {
      slug: r.slug,
      name: r.name,
      status,
      currentRoundId: current?.round.id ?? null,
      currentRoundLabel: current?.round.name ?? null,
      currentRoundPhase: phase,
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
