import type Database from 'better-sqlite3';
import { getRoundState, type GuessPhase, type RehearsalMode } from './state.js';
import { eligibleSongs, eligiblePlayers, validateGutSlate, type Validation } from './assignment.js';
import { visibleSubmissions } from './horizon.js';
import { resolveMeForRound } from './meCompetitor.js';
import { candidatesForSong, playerAvailability, type Candidate, type Availability } from './candidates.js';

export interface WorkspaceSong {
  spotifyUri: string;
  title: string;
  artists: string;
  comment: string | null;
  gutPickPlayerId: number | null;
  candidates: Candidate[];
}
export interface WorkspacePlayer { id: number; name: string }
export interface WorkspaceMine { spotifyUri: string; title: string; artists: string }
export interface WorkspaceData {
  roundId: number;
  phase: GuessPhase;
  mode: RehearsalMode;
  asOf: string | null;
  gutLockedAt: string | null;
  songs: WorkspaceSong[];
  roster: WorkspacePlayer[];
  validation: Validation;
  mine: WorkspaceMine | null;
  availability: Record<number, Availability>;
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
    .map((s) => ({
      ...s,
      gutPickPlayerId: picks.get(s.spotifyUri) ?? null,
      candidates: candidatesForSong(db, roundId, s.spotifyUri),
    }));

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

  // The marked song is excluded from `songs` by eligibleSongs, so it must be
  // surfaced separately or there is no way to unmark it (spec §6).
  // ORDER BY s.id: two competitors can submit the same spotify_uri in one
  // round, so the join can match two rows and LIMIT 1 would otherwise pick
  // non-deterministically.
  const mine = (db.prepare(
    `SELECT s.spotify_uri AS spotifyUri, s.title, s.artists
       FROM voting_lab_ballot b
       JOIN ml_submissions s
         ON s.round_id = b.round_id AND s.spotify_uri = b.spotify_uri
      WHERE b.round_id = ? AND b.is_mine = 1
      ORDER BY s.id
      LIMIT 1`,
  ).get(roundId) ?? null) as WorkspaceMine | null;

  // A plain object, not the Map playerAvailability returns — this payload is
  // serialised to JSON for the client, and a Map becomes {}.
  const availability: Record<number, Availability> =
    Object.fromEntries(playerAvailability(db, roundId, me));

  return {
    roundId,
    phase: state.phase,
    mode: state.mode,
    asOf: state.asOf,
    gutLockedAt: state.gutLockedAt,
    songs,
    roster,
    validation: validateGutSlate(db, roundId, me),
    mine,
    availability,
  };
}
