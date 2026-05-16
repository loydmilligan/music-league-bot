import type Database from 'better-sqlite3';
import type { Round } from '../types.js';
import { getRoundPhase } from '../lifecycle.js';

function row(r: any): Round {
  const base = { id: r.id, seasonId: r.season_id, mlRoundId: r.ml_round_id, name: r.name,
    description: r.description, spotifyPlaylistUrl: r.spotify_playlist_url,
    submissionDeadline: r.submission_deadline, votingDeadline: r.voting_deadline, createdAt: r.created_at };
  return { ...base, phase: getRoundPhase(base) };
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

export function updateDeadlines(
  db: Database.Database,
  roundId: number,
  sub: string | null | undefined,
  vote: string | null | undefined,
): void {
  // `undefined` means "leave column alone"; `null` or string means "write this".
  const fields: string[] = [];
  const vals: unknown[] = [];
  if (sub  !== undefined) { fields.push('submission_deadline=?'); vals.push(sub); }
  if (vote !== undefined) { fields.push('voting_deadline=?');     vals.push(vote); }
  if (!fields.length) return;
  vals.push(roundId);
  db.prepare(`UPDATE rounds SET ${fields.join(',')} WHERE id=?`).run(...vals);
}
