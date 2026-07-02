/**
 * Digest-prep checks — shared logic, mirrors the inline implementation in
 * `routes/api/digest/[roundId]/prepare/+server.ts`. Lifted here so the new
 * import-export-zip endpoint (sprint-11 Task A) can return a fresh checks
 * payload in the same round-trip without dragging the prepare endpoint
 * into its territory.
 *
 * If the prepare endpoint ever drifts in scope, reconcile here too.
 */
import type Database from 'better-sqlite3';
import { roundChatWindow, getRoundMessages } from '../chat/historyQuery.js';

export interface CheckResult {
  name: string;
  ok: boolean;
  src: string;
  count?: number;
  optional?: boolean;
}

interface RoundRow {
  id: number;
  name: string;
  description: string | null;
  submission_deadline: string | null;
  voting_deadline: string | null;
}

export function runPrepChecks(db: Database.Database, roundId: number): CheckResult[] {
  const round = db
    .prepare(
      `SELECT id, name, description, submission_deadline, voting_deadline
       FROM rounds WHERE id = ?`,
    )
    .get(roundId) as RoundRow | undefined;

  if (!round) {
    return [
      { name: 'Round metadata', ok: false, src: `export.zip · round ${roundId}` },
      { name: 'Submissions', ok: false, src: `export.zip · round ${roundId}` },
      { name: 'Votes', ok: false, src: `export.zip · round ${roundId}` },
      { name: 'Vote comments', ok: false, src: `export.zip · round ${roundId}` },
      { name: 'Chat-window mentions', ok: false, src: 'watcher · —' },
      { name: 'Chat', ok: false, src: 'chat_messages · league unmapped', count: 0, optional: true },
      { name: 'Album art', ok: false, src: 'spotify api' },
    ];
  }

  const roundSrc = `export.zip · ${round.name}`;

  const meta_ok = !!round.description;

  const subs_count = (db
    .prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?')
    .get(roundId) as { n: number }).n;

  const votes_count = (db
    .prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?')
    .get(roundId) as { n: number }).n;

  const comments_count = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM votes
       WHERE round_id = ? AND comment IS NOT NULL AND TRIM(comment) <> ''`,
    )
    .get(roundId) as { n: number }).n;

  const mentionRow = db
    .prepare(
      `SELECT COUNT(*) AS n,
              MIN(m.captured_at) AS min_at,
              MAX(m.captured_at) AS max_at
       FROM chat_mentions m
       JOIN chat_assignments a ON a.chat_song_id = m.song_id
       WHERE a.round_id = ?`,
    )
    .get(roundId) as { n: number; min_at: string | null; max_at: string | null };
  const mentions_count = mentionRow.n;
  const dateRange =
    mentionRow.min_at && mentionRow.max_at
      ? `${mentionRow.min_at.slice(0, 10)} → ${mentionRow.max_at.slice(0, 10)}`
      : '—';

  const artOk = subs_count > 0;

  // Metadata coverage checks (optional — 80% threshold mirrors Tastemaker logic)
  const threshold = subs_count === 0 ? 0 : subs_count * 0.8;

  const ytm_count = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM ml_submissions s
       JOIN ytm_link_cache y ON y.spotify_uri = s.spotify_uri
       WHERE s.round_id = ?`,
    )
    .get(roundId) as { n: number }).n;

  // Tastemaker coverage: cumulative over the season through this round, counting
  // only submissions whose song has a non-null popularity_proxy (matches the
  // getDiscoverability gate — row existence is NOT enough, and the gate also
  // requires competitor_id IS NOT NULL and a real spotify:track: URI).
  const cov = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN sp.popularity_proxy IS NOT NULL THEN 1 ELSE 0 END) AS covered
       FROM ml_submissions s
       JOIN rounds r ON r.id = s.round_id
       LEFT JOIN song_popularity sp ON sp.spotify_uri = s.spotify_uri
       WHERE r.season_id = (SELECT season_id FROM rounds WHERE id = ?)
         AND r.id <= ?
         AND s.competitor_id IS NOT NULL
         AND s.spotify_uri LIKE 'spotify:track:%'`,
    )
    .get(roundId, roundId) as { total: number; covered: number };
  const covRatio = cov.total ? cov.covered / cov.total : 0;
  const tastemakerOk = cov.total > 0 && covRatio >= 0.8;

  // Chat availability: reuse roundChatWindow (shared with round page) for the window
  const chatWin = roundChatWindow(db, roundId);
  const chatCount = chatWin.groupName
    ? getRoundMessages(db, chatWin.groupName, chatWin.fromIso, chatWin.toIso).length
    : 0;

  const tags_count = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM ml_submissions s
       JOIN song_popularity p ON p.spotify_uri = s.spotify_uri
       WHERE s.round_id = ? AND p.tags IS NOT NULL`,
    )
    .get(roundId) as { n: number }).n;

  const lyrics_count = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM ml_submissions s
       JOIN song_lyrics_metrics l ON l.spotify_uri = s.spotify_uri
       WHERE s.round_id = ?`,
    )
    .get(roundId) as { n: number }).n;

  const audio_count = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM ml_submissions s
       JOIN song_audio_features a ON a.spotify_uri = s.spotify_uri
       WHERE s.round_id = ?`,
    )
    .get(roundId) as { n: number }).n;

  return [
    { name: 'Round metadata', ok: meta_ok, src: roundSrc },
    { name: 'Submissions', ok: subs_count > 0, src: roundSrc, count: subs_count },
    { name: 'Votes', ok: votes_count > 0, src: roundSrc, count: votes_count },
    { name: 'Vote comments', ok: comments_count > 0, src: roundSrc, count: comments_count },
    {
      name: 'Chat-window mentions',
      ok: mentions_count > 0,
      src: `watcher · ${dateRange}`,
      count: mentions_count,
      optional: true,
    },
    {
      name: 'Chat',
      ok: chatCount > 0,
      src: chatWin.groupName
        ? `chat_messages · ${chatWin.groupName}`
        : 'chat_messages · league unmapped',
      count: chatCount,
      optional: true,
    },
    { name: 'Album art', ok: artOk, src: 'spotify api', count: subs_count },
    {
      name: 'YTM playlist links',
      ok: subs_count > 0 && ytm_count >= subs_count,
      src: 'ytm_link_cache',
      count: ytm_count,
      optional: true,
    },
    {
      name: 'Tastemaker leaderboard',
      ok: tastemakerOk,
      src: `song_popularity · ${cov.covered}/${cov.total} proxied`,
      count: cov.covered,
      optional: true,
    },
    {
      name: 'Genre & mood blurbs',
      ok: subs_count > 0 && tags_count >= threshold,
      src: 'song_popularity',
      count: tags_count,
      optional: true,
    },
    {
      name: 'Lyrical metrics',
      ok: subs_count > 0 && lyrics_count >= threshold,
      src: 'song_lyrics_metrics',
      count: lyrics_count,
      optional: true,
    },
    {
      name: 'Audio insights',
      ok: subs_count > 0 && audio_count >= threshold,
      src: 'song_audio_features',
      count: audio_count,
      optional: true,
    },
  ];
}
