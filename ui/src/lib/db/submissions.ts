import type Database from 'better-sqlite3';
import type { MlSubmission } from '../types.js';

export function upsertCompetitor(db: Database.Database, mlId: string, name: string): number {
  const { id: competitorId } = db.prepare(`INSERT INTO competitors (ml_competitor_id,name) VALUES (?,?)
    ON CONFLICT(ml_competitor_id) DO UPDATE SET name=excluded.name RETURNING id`).get(mlId, name) as { id: number };
  // Auto-link: if this competitor has no player_id yet, link deterministically via ml_competitor_id.
  // Non-matching competitors stay NULL — the /setup unlinked banner is the designed catch.
  db.prepare(`UPDATE competitors SET player_id = (
    SELECT id FROM players WHERE ml_competitor_id = ? LIMIT 1
  ) WHERE id = ? AND player_id IS NULL`).run(mlId, competitorId);
  return competitorId;
}

export function upsertSubmission(db: Database.Database, s: {
  roundId: number; competitorId: number; spotifyUri: string; title: string;
  album: string; artists: string; comment: string; createdAt: string; visibleToVoters: boolean;
}): void {
  // De-anonymize on refresh. While a round is in progress, Music League hides
  // submitter identities, so an earlier import may have stored this pick with
  // competitor_id IS NULL. The table's UNIQUE(round_id,spotify_uri,competitor_id)
  // treats NULL as distinct from a real id, so a naive insert of the now-revealed
  // row would accumulate a duplicate instead of updating. Drop the stale
  // anonymous placeholder first, then upsert the identified row.
  db.prepare(`DELETE FROM ml_submissions
    WHERE round_id=@roundId AND spotify_uri=@spotifyUri AND competitor_id IS NULL`)
    .run({ roundId: s.roundId, spotifyUri: s.spotifyUri });
  db.prepare(`INSERT INTO ml_submissions
    (round_id,competitor_id,spotify_uri,title,album,artists,comment,created_at,visible_to_voters,player_id)
    VALUES (@roundId,@competitorId,@spotifyUri,@title,@album,@artists,@comment,@createdAt,@visibleToVoters,
      (SELECT player_id FROM competitors WHERE id=@competitorId))
    ON CONFLICT(round_id,spotify_uri,competitor_id) DO UPDATE SET
      title=excluded.title, album=excluded.album, artists=excluded.artists,
      comment=excluded.comment, visible_to_voters=excluded.visible_to_voters,
      player_id=COALESCE(excluded.player_id, ml_submissions.player_id)`)
    .run({ ...s, visibleToVoters: s.visibleToVoters ? 1 : 0 });
}

export function upsertVote(db: Database.Database, v: {
  roundId: number; voterId: number; spotifyUri: string; points: number; comment: string; createdAt: string;
}): void {
  db.prepare(`INSERT INTO votes (round_id,voter_id,spotify_uri,points,comment,created_at,player_id)
    VALUES (@roundId,@voterId,@spotifyUri,@points,@comment,@createdAt,
      (SELECT player_id FROM competitors WHERE id=@voterId))
    ON CONFLICT(round_id,voter_id,spotify_uri) DO UPDATE SET
      points=excluded.points,
      player_id=COALESCE(excluded.player_id, votes.player_id)`).run(v);
}

export function getSubmissionsForRound(db: Database.Database, roundId: number): MlSubmission[] {
  return (db.prepare(`SELECT s.*,c.name submitter_name,COALESCE(SUM(v.points),0) total_points
    FROM ml_submissions s JOIN competitors c ON s.competitor_id=c.id
    LEFT JOIN votes v ON v.round_id=s.round_id AND v.spotify_uri=s.spotify_uri
    WHERE s.round_id=? GROUP BY s.id ORDER BY total_points DESC`).all(roundId) as any[])
    .map((r, i) => ({
      id: r.id, roundId: r.round_id, competitorId: r.competitor_id, spotifyUri: r.spotify_uri,
      title: r.title, album: r.album, artists: r.artists, comment: r.comment, createdAt: r.created_at,
      visibleToVoters: !!r.visible_to_voters, totalPoints: r.total_points, rank: i + 1,
      submitterName: r.submitter_name,
    }));
}
