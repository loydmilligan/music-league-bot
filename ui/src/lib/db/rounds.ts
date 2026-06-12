import type Database from 'better-sqlite3';
import type { Round, RoundPhase } from '../types.js';
import { getRoundPhase, getRoundPhasesForSeason } from '../lifecycle.js';

function baseRow(r: any): Omit<Round, 'phase'> {
  return { id: r.id, seasonId: r.season_id, mlRoundId: r.ml_round_id, name: r.name,
    description: r.description, spotifyPlaylistUrl: r.spotify_playlist_url,
    submissionDeadline: r.submission_deadline, votingDeadline: r.voting_deadline, createdAt: r.created_at,
    tag: r.tag ?? null, themeSubmittedBy: r.theme_submitted_by ?? null, roundNumber: r.round_number ?? null };
}

function row(r: any): Round {
  // Per-round fallback for callers without season context (one-off API).
  // Use sparingly — see lifecycle.ts deprecation note on getRoundPhase.
  const base = baseRow(r);
  return { ...base, phase: getRoundPhase(base) };
}

function rowWithPhase(r: any, phase: RoundPhase): Round {
  return { ...baseRow(r), phase };
}

export function upsertRound(db: Database.Database, seasonId: number, r: {
  mlRoundId: string; name: string; description: string; spotifyPlaylistUrl: string; createdAt: string;
}): number {
  return (db.prepare(`INSERT INTO rounds (season_id,ml_round_id,name,description,spotify_playlist_url,created_at)
    VALUES (@seasonId,@mlRoundId,@name,@description,@spotifyPlaylistUrl,@createdAt)
    ON CONFLICT(ml_round_id) DO UPDATE SET name=excluded.name,description=excluded.description,
    spotify_playlist_url=excluded.spotify_playlist_url RETURNING id`).get({ seasonId, ...r }) as { id: number }).id;
}

export function upsertRoundWithDeadlines(db: Database.Database, seasonId: number, r: {
  mlRoundId: string;
  name: string;
  description: string;
  spotifyPlaylistUrl: string | null;
  createdAt: string;
  submissionDeadline: string | null;
  votingDeadline: string | null;
}): number {
  return (db.prepare(`INSERT INTO rounds (
      season_id, ml_round_id, name, description, spotify_playlist_url,
      submission_deadline, voting_deadline, created_at
    )
    VALUES (@seasonId,@mlRoundId,@name,@description,@spotifyPlaylistUrl,@submissionDeadline,@votingDeadline,@createdAt)
    ON CONFLICT(ml_round_id) DO UPDATE SET
      season_id=excluded.season_id,
      name=excluded.name,
      description=excluded.description,
      spotify_playlist_url=excluded.spotify_playlist_url,
      submission_deadline=excluded.submission_deadline,
      voting_deadline=excluded.voting_deadline,
      created_at=excluded.created_at
    RETURNING id`).get({ seasonId, ...r }) as { id: number }).id;
}

export function getRoundsForSeason(db: Database.Database, seasonId: number): Round[] {
  const raw = db.prepare('SELECT * FROM rounds WHERE season_id=? ORDER BY id').all(seasonId) as any[];
  const bases = raw.map(baseRow);
  const phases = getRoundPhasesForSeason(
    bases.map(b => ({ id: b.id, submissionDeadline: b.submissionDeadline, votingDeadline: b.votingDeadline })),
  );
  return bases.map(b => ({ ...b, phase: phases.get(b.id) ?? 'upcoming' }));
}

export function getRoundById(db: Database.Database, id: number): Round | null {
  const r = db.prepare('SELECT * FROM rounds WHERE id=?').get(id) as any;
  if (!r) return null;
  // Load season siblings so we can phase-derive in context.
  const siblings = getRoundsForSeason(db, r.season_id);
  const phased = siblings.find(s => s.id === id);
  if (phased) return phased;
  // Defensive fallback (should never hit — id is in its own season).
  return row(r);
}

export function getCurrentRoundForSeason(db: Database.Database, seasonId: number): Round | null {
  const rounds = getRoundsForSeason(db, seasonId);
  if (rounds.length === 0) return null;
  // Priority: submission > voting > upcoming > archive, newest within tie.
  const priority: Record<RoundPhase, number> = { submission: 0, voting: 1, upcoming: 2, archive: 3 };
  const sorted = [...rounds].sort((a, b) => {
    const dp = priority[a.phase!] - priority[b.phase!];
    if (dp !== 0) return dp;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
  return sorted[0];
}

// rowWithPhase is exported for callers that already computed phases
// (e.g. the layout loader walks all of a season's rounds at once).
export { rowWithPhase };

export interface RoundPatch {
  name?: string;
  description?: string | null;     // body field is "theme" — mapped at the API boundary
  submissionDeadline?: string | null;
  votingDeadline?: string | null;
  spotifyPlaylistUrl?: string | null; // body field is "playlist_url" — mapped at the API boundary
}

/**
 * Apply a partial patch to a round. Returns true if a row was updated.
 * `undefined` fields are left alone; `null` clears the column.
 */
export function patchRound(db: Database.Database, id: number, p: RoundPatch): boolean {
  const map: Array<[keyof RoundPatch, string]> = [
    ['name', 'name'],
    ['description', 'description'],
    ['submissionDeadline', 'submission_deadline'],
    ['votingDeadline', 'voting_deadline'],
    ['spotifyPlaylistUrl', 'spotify_playlist_url'],
  ];
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of map) {
    if (p[k] !== undefined) { fields.push(`${col}=?`); vals.push(p[k]); }
  }
  if (!fields.length) return false;
  vals.push(id);
  const info = db.prepare(`UPDATE rounds SET ${fields.join(',')} WHERE id=?`).run(...vals);
  return info.changes > 0;
}

export interface RoundManagePatch {
  tag?: string | null;
  theme_submitted_by?: number | null;
  round_number?: number | null;
  name?: string;
  description?: string | null;
  submission_deadline?: string | null;
  voting_deadline?: string | null;
}

/**
 * Update round management fields (tag, theme_submitted_by, round_number, etc.).
 * Used by the setup page's round management section.
 */
export function updateRound(db: Database.Database, roundId: number, p: RoundManagePatch): boolean {
  const map: Array<[keyof RoundManagePatch, string]> = [
    ['tag', 'tag'],
    ['theme_submitted_by', 'theme_submitted_by'],
    ['round_number', 'round_number'],
    ['name', 'name'],
    ['description', 'description'],
    ['submission_deadline', 'submission_deadline'],
    ['voting_deadline', 'voting_deadline'],
  ];
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const [k, col] of map) {
    if (p[k] !== undefined) { fields.push(`${col}=?`); vals.push(p[k]); }
  }
  if (!fields.length) return false;
  vals.push(roundId);
  const info = db.prepare(`UPDATE rounds SET ${fields.join(',')} WHERE id=?`).run(...vals);
  return info.changes > 0;
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
