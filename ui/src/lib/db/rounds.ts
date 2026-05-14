import type Database from 'better-sqlite3';
import type { Round } from '../types.js';

function row(r: any): Round {
  return { id: r.id, seasonId: r.season_id, mlRoundId: r.ml_round_id, name: r.name,
    description: r.description, spotifyPlaylistUrl: r.spotify_playlist_url,
    submissionDeadline: r.submission_deadline, votingDeadline: r.voting_deadline, createdAt: r.created_at };
}

export function upsertRound(db: Database.Database, seasonId: number, r: {
  mlRoundId: string; name: string; description: string; spotifyPlaylistUrl: string; createdAt: string;
}): number {
  return (db.prepare(`INSERT INTO rounds (season_id,ml_round_id,name,description,spotify_playlist_url,created_at)
    VALUES (@seasonId,@mlRoundId,@name,@description,@spotifyPlaylistUrl,@createdAt)
    ON CONFLICT(ml_round_id) DO UPDATE SET name=excluded.name,description=excluded.description,
    spotify_playlist_url=excluded.spotify_playlist_url RETURNING id`).get({ seasonId, ...r }) as { id: number }).id;
}

export function getRoundsForSeason(db: Database.Database, seasonId: number): Round[] {
  return (db.prepare('SELECT * FROM rounds WHERE season_id=? ORDER BY created_at').all(seasonId) as any[]).map(row);
}

export function getRoundById(db: Database.Database, id: number): Round | null {
  const r = db.prepare('SELECT * FROM rounds WHERE id=?').get(id) as any;
  return r ? row(r) : null;
}

export function getCurrentRoundForSeason(db: Database.Database, seasonId: number): Round | null {
  const r = db.prepare('SELECT * FROM rounds WHERE season_id=? ORDER BY created_at DESC LIMIT 1').get(seasonId) as any;
  return r ? row(r) : null;
}

export function updateDeadlines(db: Database.Database, roundId: number, sub: string | null, vote: string | null): void {
  db.prepare('UPDATE rounds SET submission_deadline=?,voting_deadline=? WHERE id=?').run(sub, vote, roundId);
}
