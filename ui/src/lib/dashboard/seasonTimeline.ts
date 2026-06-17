import type Database from 'better-sqlite3';
import { computeStandings, type StandingRow } from '../db/standings.js';
import { getDiscoverability, type TastemakerPayload } from '../db/discoverability.js';
import { getActiveSeasonId } from '../db/activeRound.js';

export interface RoundRef { roundId: number; roundNumber: number; name: string; }

export interface RoundStandingSnapshot {
  roundId: number;
  roundNumber: number;
  name: string;
  standings: StandingRow[];
}

export interface VotePair {
  voterId: number; voterName: string;
  targetId: number; targetName: string;
  roundId: number; roundNumber: number;
  points: number;
  song: string;
}

export interface SeasonTimeline {
  leagueId: number;
  seasonId: number | null;
  rounds: RoundRef[];
  standingsByRound: RoundStandingSnapshot[];
  tastemakerByRound: Map<number, TastemakerPayload | null>;
  votePairs: VotePair[];
}

export function buildSeasonTimeline(db: Database.Database, leagueId: number): SeasonTimeline {
  const seasonId = getActiveSeasonId(db, leagueId);
  if (seasonId == null) {
    return { leagueId, seasonId: null, rounds: [], standingsByRound: [], tastemakerByRound: new Map(), votePairs: [] };
  }

  const rounds = db.prepare(
    `SELECT r.id AS roundId, r.round_number AS rn, r.name AS name
     FROM rounds r
     WHERE r.season_id = ?
       AND EXISTS (SELECT 1 FROM votes v WHERE v.round_id = r.id)
     ORDER BY r.round_number IS NULL, r.round_number, r.id`,
  ).all(seasonId) as { roundId: number; rn: number | null; name: string }[];

  const refs: RoundRef[] = rounds.map((r, i) => ({ roundId: r.roundId, roundNumber: r.rn ?? i + 1, name: r.name }));

  const standingsByRound: RoundStandingSnapshot[] = refs.map(ref => ({
    roundId: ref.roundId, roundNumber: ref.roundNumber, name: ref.name,
    standings: computeStandings(db, ref.roundId),
  }));

  const tastemakerByRound = new Map<number, TastemakerPayload | null>();
  for (const ref of refs) tastemakerByRound.set(ref.roundId, getDiscoverability(db, ref.roundId));

  const roundIds = refs.map(r => r.roundId);
  const votePairs: VotePair[] = roundIds.length === 0 ? [] : (db.prepare(
    `SELECT v.round_id AS roundId, v.points AS points, v.spotify_uri AS song,
            vc.id AS voterId, vc.name AS voterName,
            sc.id AS targetId, sc.name AS targetName
     FROM votes v
     JOIN competitors vc ON vc.id = v.voter_id
     JOIN ml_submissions m ON m.round_id = v.round_id AND m.spotify_uri = v.spotify_uri
     JOIN competitors sc ON sc.id = m.competitor_id
     WHERE v.round_id IN (${roundIds.map(() => '?').join(',')})`,
  ).all(...roundIds) as Omit<VotePair, 'roundNumber'>[])
    .map(p => ({ ...p, roundNumber: refs.find(r => r.roundId === p.roundId)!.roundNumber }));

  return { leagueId, seasonId, rounds: refs, standingsByRound, tastemakerByRound, votePairs };
}
