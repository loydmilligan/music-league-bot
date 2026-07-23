import type Database from 'better-sqlite3';
import { getBallot, resolveBudget } from './ballotDb.js';
import type { BallotEntry, LabData, LabRow, LabSong } from './types.js';

type RoundRow = { id: number; name: string; description: string | null };

type SongRow = {
  submission_id: number;
  spotify_uri: string;
  title: string;
  artists: string | null;
  album_art_url: string | null;
  listeners: number | null;
  spotify_popularity: number | null;
  tags: string | null;
  bpm: number | null;
  energy: number | null;
  has_lyrics: number | null;
};

function emptyBallot(spotifyUri: string): BallotEntry {
  return {
    spotifyUri, upPoints: 0, downPoints: 0, rating: null,
    notes: '', draftComment: '', isMine: false,
  };
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

/**
 * Everything the lab needs for one round: the songs (submitter deliberately
 * NOT selected — the lab never shows or sends it), their metadata, the saved
 * ballot merged in, and the resolved budget.
 */
export function buildLabData(db: Database.Database, roundId: number): LabData {
  const round = db.prepare(
    `SELECT id, name, description FROM rounds WHERE id = ?`,
  ).get(roundId) as RoundRow | undefined;
  if (!round) throw new Error(`buildLabData: unknown round ${roundId}`);

  const songRows = db.prepare(
    `SELECT s.id AS submission_id, s.spotify_uri, s.title, s.artists, s.album_art_url,
            p.listeners, p.spotify_popularity, p.tags,
            a.bpm, a.energy,
            l.has_lyrics
     FROM ml_submissions s
     LEFT JOIN song_popularity     p ON p.spotify_uri = s.spotify_uri
     LEFT JOIN song_audio_features a ON a.spotify_uri = s.spotify_uri
     LEFT JOIN song_lyrics_metrics l ON l.spotify_uri = s.spotify_uri
     WHERE s.round_id = ?
     ORDER BY s.id`,
  ).all(roundId) as SongRow[];

  const saved = new Map(getBallot(db, roundId).map((e) => [e.spotifyUri, e]));

  const rows: LabRow[] = songRows.map((r) => {
    const song: LabSong = {
      submissionId: r.submission_id,
      spotifyUri: r.spotify_uri,
      title: r.title,
      artist: r.artists ?? '',
      albumArtUrl: r.album_art_url,
      spotifyPopularity: r.spotify_popularity,
      listeners: r.listeners,
      bpm: r.bpm,
      energy: r.energy,
      hasLyrics: r.has_lyrics === null ? null : r.has_lyrics === 1,
      tags: parseTags(r.tags),
    };
    return { song, ballot: saved.get(r.spotify_uri) ?? emptyBallot(r.spotify_uri) };
  });

  const { budget, source } = resolveBudget(db, roundId);

  return {
    roundId: round.id,
    themeName: round.name,
    themeDescription: round.description ?? '',
    budget,
    budgetSource: source,
    rows,
  };
}
