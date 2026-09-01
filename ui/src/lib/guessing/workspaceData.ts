import type Database from 'better-sqlite3';
import { getRoundState, type GuessPhase, type RehearsalMode } from './state.js';
import { eligibleSongs, eligiblePlayers, validateGutSlate, type Validation } from './assignment.js';
import { visibleSubmissions } from './horizon.js';
import { resolveMeForRound } from './meCompetitor.js';

export interface WorkspaceSong {
  spotifyUri: string;
  title: string;
  artists: string;
  comment: string | null;
  gutPickPlayerId: number | null;
}
export interface WorkspacePlayer { id: number; name: string }
export interface WorkspaceData {
  roundId: number;
  phase: GuessPhase;
  mode: RehearsalMode;
  asOf: string | null;
  gutLockedAt: string | null;
  songs: WorkspaceSong[];
  roster: WorkspacePlayer[];
  validation: Validation;
}

/**
 * Everything the workspace tab renders for one round.
 *
 * Returns null when the league has no me-competitor set — the caller shows a
 * setup prompt rather than a broken grid, because without it the roster cannot
 * exclude Matt and every downstream rule is wrong.
 *
 * NOT on the §5 anonymity allowlist: reads competitors.name for the roster, and
 * song text via visibleSubmissions, but never ml_submissions.competitor_id.
 */
export function buildWorkspaceData(db: Database.Database, roundId: number): WorkspaceData | null {
  const me = resolveMeForRound(db, roundId);
  if (me === null) return null;

  const state = getRoundState(db, roundId);
  const uris = new Set(eligibleSongs(db, roundId));

  const picks = new Map(
    (
      db.prepare(
        `SELECT spotify_uri AS uri, gut_pick_player_id AS pid
           FROM guess_picks WHERE round_id = ?`,
      ).all(roundId) as { uri: string; pid: number | null }[]
    ).map((r) => [r.uri, r.pid]),
  );

  const songs: WorkspaceSong[] = visibleSubmissions(db, roundId)
    .filter((s) => uris.has(s.spotifyUri))
    .map((s) => ({ ...s, gutPickPlayerId: picks.get(s.spotifyUri) ?? null }));

  const ids = eligiblePlayers(db, roundId, me);
  const roster: WorkspacePlayer[] =
    ids.length === 0
      ? []
      : (db
          .prepare(
            `SELECT id, name FROM competitors WHERE id IN (${ids.map(() => '?').join(',')})
              ORDER BY id`,
          )
          .all(...ids) as WorkspacePlayer[]);

  return {
    roundId,
    phase: state.phase,
    mode: state.mode,
    asOf: state.asOf,
    gutLockedAt: state.gutLockedAt,
    songs,
    roster,
    validation: validateGutSlate(db, roundId, me),
  };
}
