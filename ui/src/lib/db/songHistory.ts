import type Database from 'better-sqlite3';

// Song-history status service (sprint-23, song-history-api) — powers the D3
// "me vs others" encoding and the expanded-card corpus-history panel. Given a
// batch of search results (spotifyUri + artist) it returns, per uri, whether
// I submitted it, who else submitted it (with league/season/round/points),
// whether I've submitted *anything* by that artist, and any chat mentions.
//
// Batch-shaped on purpose: a whole Spotify search page resolves in ONE call,
// not N round-trips. Joins follow the corpus patterns in research.ts /
// seasonData.ts (rounds→seasons→leagues, points = SUM(votes.points) per
// submission, "me" = competitors.ml_competitor_id === MY_COMPETITOR_ID,
// artist = first comma-separated token of ml_submissions.artists).

export interface SongStatusInput {
  uri: string;
  artist: string;
}

export interface OtherSubmission {
  league: string;
  season: number;
  round: string;
  by: string;
  points: number;
}

export interface ChatMention {
  by: string;
  quote: string;
}

export interface SongStatus {
  submittedByMe: boolean;
  submittedByOthers: OtherSubmission[];
  artistSubmittedByMe: boolean;
  chatMentions: ChatMention[];
}

export type SongStatusMap = Record<string, SongStatus>;

/** First comma-separated artist, lowercased + trimmed — the corpus join key. */
function firstArtist(artists: string): string {
  return (artists.split(',')[0] ?? artists).trim().toLowerCase();
}

function blank(): SongStatus {
  return { submittedByMe: false, submittedByOthers: [], artistSubmittedByMe: false, chatMentions: [] };
}

/**
 * Resolve history status for a batch of songs in one pass per source table.
 * @param items   the search results to look up ({uri, artist})
 * @param myId    competitors.ml_competitor_id for "me" (defaults to MY_COMPETITOR_ID)
 */
export function getSongStatusBatch(
  db: Database.Database,
  items: SongStatusInput[],
  myId: string | undefined = process.env.MY_COMPETITOR_ID,
): SongStatusMap {
  const out: SongStatusMap = {};
  // De-dupe uris while preserving every requested key in the response.
  const uris = Array.from(new Set(items.map((i) => i.uri).filter(Boolean)));
  for (const it of items) out[it.uri] = blank();
  if (!uris.length) return out;

  const ph = uris.map(() => '?').join(',');

  // 1. Submissions — every appearance of these uris with cumulative points,
  //    submitter name, and the submitter's ml id (to split me vs others).
  const subs = db
    .prepare(
      `SELECT m.spotify_uri AS uri,
              l.name AS league, s.season_number AS season, r.name AS round,
              c.name AS by, c.ml_competitor_id AS by_ml_id,
              COALESCE(SUM(v.points), 0) AS points
       FROM ml_submissions m
       JOIN rounds r ON r.id = m.round_id
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       LEFT JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE m.spotify_uri IN (${ph})
       GROUP BY m.id`,
    )
    .all(...uris) as {
    uri: string; league: string; season: number; round: string;
    by: string | null; by_ml_id: string | null; points: number;
  }[];

  for (const r of subs) {
    const st = out[r.uri];
    if (!st) continue;
    if (myId && r.by_ml_id === myId) {
      st.submittedByMe = true;
    } else {
      st.submittedByOthers.push({
        league: r.league,
        season: Number(r.season),
        round: r.round,
        by: r.by ?? 'Unknown',
        points: Number(r.points),
      });
    }
  }

  // 2. artistSubmittedByMe — has MY competitor submitted ANY song whose first
  //    artist matches the requested artist? One query builds my artist set.
  if (myId) {
    const mine = db
      .prepare(
        `SELECT DISTINCT m.artists AS artists
         FROM ml_submissions m
         JOIN competitors c ON c.id = m.competitor_id
         WHERE c.ml_competitor_id = ?`,
      )
      .all(myId) as { artists: string }[];
    const myArtists = new Set(mine.map((m) => firstArtist(m.artists)));
    for (const it of items) {
      const key = (it.artist ?? '').trim().toLowerCase();
      if (key && myArtists.has(key)) out[it.uri].artistSubmittedByMe = true;
    }
  }

  // 3. Chat mentions — chat_songs (keyed by uri) → chat_mentions (sender + quote).
  const mentions = db
    .prepare(
      `SELECT cs.spotify_uri AS uri, cm.sender_name AS by, cm.raw_message AS quote
       FROM chat_songs cs
       JOIN chat_mentions cm ON cm.song_id = cs.id
       WHERE cs.spotify_uri IN (${ph})
       ORDER BY cm.captured_at`,
    )
    .all(...uris) as { uri: string; by: string; quote: string }[];

  for (const m of mentions) {
    const st = out[m.uri];
    if (st) st.chatMentions.push({ by: m.by, quote: m.quote });
  }

  return out;
}
