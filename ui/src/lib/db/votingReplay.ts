import type Database from 'better-sqlite3';
import type { ReplayBallot, ReplayPayload, ReplaySong } from '$lib/league-research/replayTypes.js';

/** One round's voting timeline. Ballots are atomic: one timestamp per player. */
export function getVotingReplay(db: Database.Database, roundId: number): ReplayPayload | null {
  const round = db.prepare(
    'SELECT id, name, COALESCE(description, \'\') AS description, voting_deadline FROM rounds WHERE id = ?',
  ).get(roundId) as { id: number; name: string; description: string; voting_deadline: string | null } | undefined;
  if (!round) return null;

  const songs = db.prepare(
    `SELECT m.spotify_uri AS uri, m.title, m.artists AS artist, m.comment AS submitterComment,
            COALESCE(p.name, c.name) AS submitter
       FROM ml_submissions m
       JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN players p ON p.id = c.player_id
      WHERE m.round_id = ?
      ORDER BY m.spotify_uri`,
  ).all(roundId) as ReplaySong[];

  const rows = db.prepare(
    `SELECT COALESCE(p.name, c.name) AS voter, v.created_at AS castAt,
            v.spotify_uri AS uri, v.points, v.comment
       FROM votes v
       JOIN competitors c ON c.id = v.voter_id
       LEFT JOIN players p ON p.id = c.player_id
      WHERE v.round_id = ?
      ORDER BY v.created_at, v.id`,
  ).all(roundId) as Array<{ voter: string; castAt: string; uri: string; points: number; comment: string | null }>;

  const byVoter = new Map<string, ReplayBallot>();
  for (const r of rows) {
    const existing = byVoter.get(r.voter);
    if (existing) {
      existing.votes.push({ uri: r.uri, points: r.points, comment: r.comment });
      if (r.castAt > existing.castAt) existing.castAt = r.castAt;
    } else {
      byVoter.set(r.voter, { voter: r.voter, castAt: r.castAt, votes: [{ uri: r.uri, points: r.points, comment: r.comment }] });
    }
  }
  const ballots = [...byVoter.values()].sort((a, b) => a.castAt.localeCompare(b.castAt));

  const lastSub = db.prepare(
    'SELECT MAX(created_at) AS t FROM ml_submissions WHERE round_id = ?',
  ).get(roundId) as { t: string | null };

  return {
    round: {
      id: round.id, name: round.name, description: round.description,
      votingDeadline: round.voting_deadline, windowOpensAfter: lastSub.t,
    },
    songs, ballots,
  };
}
