/**
 * Active-round management (sprint-22, History Phase 1).
 *
 * The app needs to know which leagues are *currently being played* and hold a
 * clear "active round" slot per active league — the seeds Tab 2 (theme research)
 * researches against. Detection already exists (derived current-round via
 * lifecycle phases), but we want MANUAL control on top (D4 manual-first):
 *
 *   - leagues.is_active        — operator marks a league "currently played".
 *   - leagues.active_round_id  — the manual active-round slot (one per league).
 *
 * Resolution order for "the active round of a league":
 *   1. the manual slot (active_round_id), if set and still pointing at a round;
 *   2. else the DERIVED current round of the league's active season;
 *   3. else null  → the UI shows the "no active round — choose/create" modal.
 */
import type Database from 'better-sqlite3';
import type { RoundPhase } from '../types.js';
import { getRoundById, getCurrentRoundForSeason, getRoundsForSeason } from './rounds.js';
import { pickActiveRound } from './activeRoundDerive.js';

export type ActiveRoundSource = 'manual' | 'derived';

export interface ActiveRoundView {
  id: number;
  name: string;
  theme: string | null;
  submissionDeadline: string | null;
  votingDeadline: string | null;
  phase: RoundPhase;
  source: ActiveRoundSource;
}

export interface AvailableRound {
  id: number;
  name: string;
  phase: RoundPhase;
  submissionDeadline: string | null;
  votingDeadline: string | null;
}

export interface LeagueActiveRound {
  leagueId: number;
  slug: string;
  name: string;
  isActive: boolean;
  manuallyActive: boolean;
  activeSeasonId: number | null;
  needsNextRound: boolean;
  /** The resolved active round (manual slot → derived → null). */
  activeRound: ActiveRoundView | null;
  /** Rounds of the active season — the "choose from this list" set for the modal. */
  availableRounds: AvailableRound[];
}

interface LeagueRow {
  id: number;
  slug: string;
  name: string;
  is_active: number;
  active_round_id: number | null;
}

function seasonHasLiveRound(db: Database.Database, seasonId: number): boolean {
  const current = getCurrentRoundForSeason(db, seasonId);
  return !!current && current.phase !== 'archive';
}

/** Most-recent active season id for a league (null if none). */
export function getActiveSeasonId(db: Database.Database, leagueId: number): number | null {
  const seasons = db.prepare(
    `SELECT id, season_number, status FROM seasons
     WHERE league_id = ?
     ORDER BY season_number DESC`,
  ).all(leagueId) as Array<{ id: number; season_number: number; status: string }>;
  for (const season of seasons) {
    if (season.status === 'active' || seasonHasLiveRound(db, season.id)) {
      return season.id;
    }
  }
  return null;
}

/** Mark a league active / inactive. Returns true if a row changed. */
export function markLeagueActive(db: Database.Database, leagueId: number, active: boolean): boolean {
  const info = db.prepare('UPDATE leagues SET is_active = ? WHERE id = ?').run(active ? 1 : 0, leagueId);
  return info.changes > 0;
}

/**
 * Set (or clear, with roundId=null) a league's manual active-round slot.
 * When roundId is given it MUST belong to a season of this league, else throws.
 */
export function setActiveRound(db: Database.Database, leagueId: number, roundId: number | null): void {
  if (roundId !== null) {
    const owns = db.prepare(
      `SELECT 1 FROM rounds r JOIN seasons s ON s.id = r.season_id
        WHERE r.id = ? AND s.league_id = ?`,
    ).get(roundId, leagueId);
    if (!owns) throw new Error(`round ${roundId} does not belong to league ${leagueId}`);
  }
  db.prepare('UPDATE leagues SET active_round_id = ? WHERE id = ?').run(roundId, leagueId);
}

function resolveActiveRound(db: Database.Database, league: LeagueRow, activeSeasonId: number | null): ActiveRoundView | null {
  const seasonRounds = activeSeasonId != null ? getRoundsForSeason(db, activeSeasonId) : [];

  // If the pin points outside the active season, evaluate it directly.
  // A cross-season pin that is non-archive is honoured; archive or dangling → treat as no pin.
  let effectivePinId = league.active_round_id;
  if (effectivePinId != null && !seasonRounds.some(r => r.id === effectivePinId)) {
    const pinned = getRoundById(db, effectivePinId);
    if (pinned && pinned.phase !== 'archive') {
      return {
        id: pinned.id, name: pinned.name, theme: pinned.description,
        submissionDeadline: pinned.submissionDeadline, votingDeadline: pinned.votingDeadline,
        phase: pinned.phase ?? 'upcoming', source: 'manual',
      };
    }
    effectivePinId = null; // dangling or archived cross-season pin → fall through
  }

  // Shared derivation: pin (if non-archive) → deadline-derived → null.
  const picked = pickActiveRound(seasonRounds, effectivePinId);
  if (!picked) return null;
  const r = picked.round;
  return {
    id: r.id, name: r.name, theme: r.description,
    submissionDeadline: r.submissionDeadline, votingDeadline: r.votingDeadline,
    phase: r.phase ?? 'upcoming', source: picked.source,
  };
}

function buildLeagueActiveRound(db: Database.Database, league: LeagueRow): LeagueActiveRound {
  const activeSeasonId = getActiveSeasonId(db, league.id);
  const availableRounds: AvailableRound[] = activeSeasonId != null
    ? getRoundsForSeason(db, activeSeasonId).map(r => ({
        id: r.id, name: r.name, phase: r.phase ?? 'upcoming',
        submissionDeadline: r.submissionDeadline, votingDeadline: r.votingDeadline,
      }))
    : [];
  const manualRound = league.active_round_id != null ? getRoundById(db, league.active_round_id) : null;
  const needsNextRound = !manualRound && availableRounds.length > 0 && availableRounds.every((r) => r.phase === 'archive');
  return {
    leagueId: league.id,
    slug: league.slug,
    name: league.name,
    isActive: !!league.is_active || activeSeasonId != null,
    manuallyActive: !!league.is_active,
    activeSeasonId,
    needsNextRound,
    activeRound: resolveActiveRound(db, league, activeSeasonId),
    availableRounds,
  };
}

/** Per active league: its resolved active round (or null) + the choose-list. */
export function getActiveLeaguesActiveRounds(db: Database.Database): LeagueActiveRound[] {
  const leagues = db.prepare(
    'SELECT id, slug, name, is_active, active_round_id FROM leagues ORDER BY id',
  ).all() as LeagueRow[];
  return leagues
    .map(l => buildLeagueActiveRound(db, l))
    .filter(l => l.isActive);
}

/** Single league's active-round view (used by the set/create endpoints to echo state). */
export function getLeagueActiveRound(db: Database.Database, leagueId: number): LeagueActiveRound | null {
  const l = db.prepare(
    'SELECT id, slug, name, is_active, active_round_id FROM leagues WHERE id = ?',
  ).get(leagueId) as LeagueRow | undefined;
  return l ? buildLeagueActiveRound(db, l) : null;
}

export interface CreateRoundOpts {
  name: string;
  theme?: string | null;
  submissionDeadline?: string | null;
  votingDeadline?: string | null;
  /** When true, also point the league's active-round slot at the new round. */
  setActive?: boolean;
  /** Override the target season; defaults to the league's active season. */
  seasonId?: number;
}

/**
 * Create a round (with deadlines) under a league's active season. The ML export
 * is the source of truth for imported rounds, so a hand-created round gets a
 * synthetic, namespaced ml_round_id (`manual:<seasonId>:<ts>`) that won't
 * collide with a real ML id. NOTE: if the same round is later imported from ML
 * it arrives under its real ml_round_id → a duplicate row (known manual-first
 * gotcha; reconcile by setting the slot to the imported round + deleting this).
 */
export function createRoundWithDeadlines(
  db: Database.Database,
  leagueId: number,
  opts: CreateRoundOpts,
): { roundId: number; seasonId: number } {
  const seasonId = opts.seasonId ?? getActiveSeasonId(db, leagueId);
  if (seasonId == null) {
    throw new Error(`league ${leagueId} has no active season — activate a season before creating a round`);
  }
  // Confirm the season belongs to this league (guards an explicit seasonId).
  const owns = db.prepare('SELECT 1 FROM seasons WHERE id = ? AND league_id = ?').get(seasonId, leagueId);
  if (!owns) throw new Error(`season ${seasonId} does not belong to league ${leagueId}`);

  const now = new Date().toISOString();
  const mlRoundId = `manual:${seasonId}:${Date.now()}`;
  const { id } = db.prepare(
    `INSERT INTO rounds (season_id, ml_round_id, name, description, submission_deadline, voting_deadline, created_at)
     VALUES (@seasonId, @mlRoundId, @name, @description, @sub, @vote, @createdAt)
     RETURNING id`,
  ).get({
    seasonId,
    mlRoundId,
    name: opts.name,
    description: opts.theme ?? null,
    sub: opts.submissionDeadline ?? null,
    vote: opts.votingDeadline ?? null,
    createdAt: now,
  }) as { id: number };

  if (opts.setActive) setActiveRound(db, leagueId, id);
  return { roundId: id, seasonId };
}
