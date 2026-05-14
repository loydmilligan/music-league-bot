import type Database from 'better-sqlite3';
import type { MlSubmission } from '../types.js';

export function upsertCompetitor(db: Database.Database, mlId: string, name: string): number {
  return (db.prepare(`INSERT INTO competitors (ml_competitor_id,name) VALUES (?,?)
    ON CONFLICT(ml_competitor_id) DO UPDATE SET name=excluded.name RETURNING id`).get(mlId, name) as { id: number }).id;
}

export function upsertSubmission(db: Database.Database, s: {
  roundId: number; competitorId: number; spotifyUri: string; title: string;
  album: string; artists: string; comment: string; createdAt: string; visibleToVoters: boolean;
}): void {
  db.prepare(`INSERT INTO ml_submissions
    (round_id,competitor_id,spotify_uri,title,album,artists,comment,created_at,visible_to_voters)
    VALUES (@roundId,@competitorId,@spotifyUri,@title,@album,@artists,@comment,@createdAt,@visibleToVoters)
    ON CONFLICT(round_id,spotify_uri,competitor_id) DO UPDATE SET title=excluded.title`)
    .run({ ...s, visibleToVoters: s.visibleToVoters ? 1 : 0 });
}

export function upsertVote(db: Database.Database, v: {
  roundId: number; voterId: number; spotifyUri: string; points: number; comment: string; createdAt: string;
}): void {
  db.prepare(`INSERT INTO votes (round_id,voter_id,spotify_uri,points,comment,created_at)
    VALUES (@roundId,@voterId,@spotifyUri,@points,@comment,@createdAt)
    ON CONFLICT(round_id,voter_id,spotify_uri) DO UPDATE SET points=excluded.points`).run(v);
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
