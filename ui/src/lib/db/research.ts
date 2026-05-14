import type Database from 'better-sqlite3';
import type { ResearchSong } from '../types.js';

function row(r: any): ResearchSong {
  return {
    id: r.id, roundId: r.round_id, spotifyUri: r.spotify_uri, title: r.title, artist: r.artist,
    album: r.album, addedAt: r.added_at, notes: r.notes,
    themeFit: r.theme_fit, discoveryPotential: r.discovery_potential,
    nostalgiaPotential: r.nostalgia_potential, personalRating: r.personal_rating,
    saveForFuture: !!r.save_for_future, submittedByMe: !!r.submitted_by_me,
    submittedByOther: !!r.submitted_by_other, otherSubmissionVotes: r.other_submission_votes,
  };
}

export function getResearchSongs(db: Database.Database, roundId: number): ResearchSong[] {
  return (db.prepare('SELECT * FROM research_songs WHERE round_id=? ORDER BY added_at').all(roundId) as any[]).map(row);
}

export function addResearchSong(db: Database.Database, s: {
  roundId: number; spotifyUri: string; title: string; artist: string; album: string | null;
}): ResearchSong {
  const myId = process.env.MY_COMPETITOR_ID;
  const mySubmission = myId
    ? db.prepare(`SELECT ms.*, COALESCE(SUM(v.points),0) pts FROM ml_submissions ms
        JOIN competitors c ON ms.competitor_id=c.id
        LEFT JOIN votes v ON v.round_id=ms.round_id AND v.spotify_uri=ms.spotify_uri
        WHERE ms.spotify_uri=? AND c.ml_competitor_id=? GROUP BY ms.id`).get(s.spotifyUri, myId) as any
    : null;
  const otherSubmission = db.prepare(`SELECT ms.*, COALESCE(SUM(v.points),0) pts FROM ml_submissions ms
    LEFT JOIN votes v ON v.round_id=ms.round_id AND v.spotify_uri=ms.spotify_uri
    WHERE ms.spotify_uri=?${myId ? ' AND ms.competitor_id != (SELECT id FROM competitors WHERE ml_competitor_id=?)' : ''}
    GROUP BY ms.id LIMIT 1`).get(...(myId ? [s.spotifyUri, myId] : [s.spotifyUri])) as any;

  db.prepare(`INSERT OR IGNORE INTO research_songs
    (round_id,spotify_uri,title,artist,album,added_at,submitted_by_me,submitted_by_other,other_submission_votes)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(s.roundId, s.spotifyUri, s.title, s.artist, s.album ?? null,
      new Date().toISOString(), mySubmission ? 1 : 0,
      otherSubmission ? 1 : 0, otherSubmission?.pts ?? null);

  return row(db.prepare('SELECT * FROM research_songs WHERE round_id=? AND spotify_uri=?').get(s.roundId, s.spotifyUri) as any);
}

export function updateResearchSong(db: Database.Database, id: number, patch: Partial<Omit<ResearchSong,'id'|'roundId'|'spotifyUri'|'addedAt'>>): void {
  const fields: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string,string> = {
    notes: 'notes', themeFit: 'theme_fit', discoveryPotential: 'discovery_potential',
    nostalgiaPotential: 'nostalgia_potential', personalRating: 'personal_rating',
    saveForFuture: 'save_for_future', submittedByMe: 'submitted_by_me',
    submittedByOther: 'submitted_by_other', otherSubmissionVotes: 'other_submission_votes',
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) { fields.push(`${col}=?`); vals.push((patch as any)[k] === true ? 1 : (patch as any)[k] === false ? 0 : (patch as any)[k]); }
  }
  if (!fields.length) return;
  vals.push(id);
  db.prepare(`UPDATE research_songs SET ${fields.join(',')} WHERE id=?`).run(...vals);
}

export function deleteResearchSong(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM research_songs WHERE id=?').run(id);
}
