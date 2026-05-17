import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ShortlistSong, ShortlistAssignment } from '../types.js';

function songRow(r: any): ShortlistSong {
  return {
    id: r.id,
    spotifyUri: r.spotify_uri,
    artist: r.artist,
    title: r.title,
    album: r.album,
    year: r.year,
    durationSec: r.duration_sec,
    albumArtUrl: r.album_art_url,
    addedAt: r.added_at,
    ratingDiscovery: r.rating_discovery,
    ratingThemeFit: r.rating_theme_fit,
    ratingNostalgia: r.rating_nostalgia,
    ratingPersonal: r.rating_personal,
    submittedElsewhere: !!r.submitted_elsewhere,
    notes: r.notes,
  };
}

function assignmentRow(r: any): ShortlistAssignment {
  return { shortlistSongId: r.shortlist_song_id, roundId: r.round_id, assignedAt: r.assigned_at };
}

export function getShortlistSongs(db: Database.Database): ShortlistSong[] {
  const songs = (db.prepare('SELECT * FROM shortlist_songs ORDER BY added_at DESC').all() as any[]).map(songRow);
  const assignments = (db.prepare('SELECT * FROM shortlist_assignments').all() as any[]).map(assignmentRow);
  const byId: Record<string, ShortlistAssignment[]> = {};
  for (const a of assignments) {
    (byId[a.shortlistSongId] ??= []).push(a);
  }
  return songs.map(s => ({ ...s, assignments: byId[s.id] ?? [] }));
}

export function addShortlistSong(db: Database.Database, s: {
  spotifyUri: string; title: string; artist: string;
  album?: string | null; albumArtUrl?: string | null;
  year?: number | null; durationSec?: number | null;
}): ShortlistSong {
  const id = randomUUID();
  db.prepare(`INSERT OR IGNORE INTO shortlist_songs
    (id, spotify_uri, title, artist, album, album_art_url, year, duration_sec)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.spotifyUri, s.title, s.artist, s.album ?? null, s.albumArtUrl ?? null, s.year ?? null, s.durationSec ?? null);
  const row = db.prepare('SELECT * FROM shortlist_songs WHERE spotify_uri=?').get(s.spotifyUri) as any;
  return { ...songRow(row), assignments: [] };
}

export function deleteShortlistSongById(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM shortlist_songs WHERE id=?').run(id);
}

export function deleteShortlistSongByUri(db: Database.Database, spotifyUri: string): void {
  db.prepare('DELETE FROM shortlist_songs WHERE spotify_uri=?').run(spotifyUri);
}

export function patchShortlistRating(db: Database.Database, id: string, dimension: 'discovery' | 'theme_fit' | 'nostalgia' | 'personal', value: number): void {
  const col = `rating_${dimension}`;
  db.prepare(`UPDATE shortlist_songs SET ${col}=? WHERE id=?`).run(value, id);
}

export function patchShortlistNotes(db: Database.Database, id: string, notes: string): void {
  db.prepare('UPDATE shortlist_songs SET notes=? WHERE id=?').run(notes, id);
}

export function patchSubmittedElsewhere(db: Database.Database, id: string, value: boolean): void {
  db.prepare('UPDATE shortlist_songs SET submitted_elsewhere=? WHERE id=?').run(value ? 1 : 0, id);
}

export function assignToRound(db: Database.Database, shortlistSongId: string, roundId: number): void {
  db.prepare(`INSERT OR IGNORE INTO shortlist_assignments (shortlist_song_id, round_id) VALUES (?, ?)`)
    .run(shortlistSongId, roundId);
  const song = db.prepare('SELECT * FROM shortlist_songs WHERE id=?').get(shortlistSongId) as any;
  if (song) {
    db.prepare(`INSERT OR IGNORE INTO research_songs
      (round_id, spotify_uri, title, artist, album, added_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(roundId, song.spotify_uri, song.title, song.artist, song.album ?? null, new Date().toISOString());
  }
}

export function unassignFromRound(db: Database.Database, shortlistSongId: string, roundId: number): void {
  db.prepare('DELETE FROM shortlist_assignments WHERE shortlist_song_id=? AND round_id=?').run(shortlistSongId, roundId);
}

export function getOpenRounds(db: Database.Database): { id: number; name: string; description: string | null; submissionDeadline: string | null; leagueName: string }[] {
  return (db.prepare(`
    SELECT r.id, r.name, r.description, r.submission_deadline,
           l.name AS league_name
    FROM rounds r
    JOIN seasons s ON r.season_id = s.id
    JOIN leagues l ON s.league_id = l.id
    WHERE r.submission_deadline IS NULL OR r.submission_deadline > datetime('now')
    ORDER BY r.submission_deadline ASC NULLS LAST
  `).all() as any[]).map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    submissionDeadline: r.submission_deadline,
    leagueName: r.league_name,
  }));
}
