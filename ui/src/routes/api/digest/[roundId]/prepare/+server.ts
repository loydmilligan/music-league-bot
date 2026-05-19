import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import type Database from 'better-sqlite3';

interface CheckResult {
  name: string;
  ok: boolean;
  src: string;
  count?: number;
}

interface RoundRow {
  id: number;
  name: string;
  description: string | null;
  submission_deadline: string | null;
  voting_deadline: string | null;
}

function runChecks(db: Database.Database, roundId: number): CheckResult[] {
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
      { name: 'Album art', ok: false, src: 'spotify api' },
    ];
  }

  const roundSrc = `export.zip · ${round.name}`;

  // 1. Round metadata — has theme + both deadlines
  const meta_ok =
    !!round.description &&
    !!round.submission_deadline &&
    !!round.voting_deadline;

  // 2. Submissions
  const subRow = db
    .prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?')
    .get(roundId) as { n: number };
  const subs_count = subRow.n;

  // 3. Votes
  const voteRow = db
    .prepare('SELECT COUNT(*) AS n FROM votes WHERE round_id = ?')
    .get(roundId) as { n: number };
  const votes_count = voteRow.n;

  // 4. Vote comments
  const commentRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM votes
       WHERE round_id = ? AND comment IS NOT NULL AND TRIM(comment) <> ''`,
    )
    .get(roundId) as { n: number };
  const comments_count = commentRow.n;

  // 5. Chat-window mentions for this round's assigned chat songs
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

  // 6. Album art — ml_submissions doesn't cache art, but every submission
  //    carries a spotify_uri (NOT NULL) which the Spotify API can resolve.
  //    OK when there are submissions to fetch art for.
  const artOk = subs_count > 0;

  return [
    { name: 'Round metadata', ok: meta_ok, src: roundSrc },
    { name: 'Submissions', ok: subs_count > 0, src: roundSrc, count: subs_count },
    { name: 'Votes', ok: votes_count > 0, src: roundSrc, count: votes_count },
    { name: 'Vote comments', ok: comments_count > 0, src: roundSrc, count: comments_count },
    { name: 'Chat-window mentions', ok: mentions_count > 0, src: `watcher · ${dateRange}`, count: mentions_count },
    { name: 'Album art', ok: artOk, src: 'spotify api', count: subs_count },
  ];
}

// POST /api/digest/:roundId/prepare — runs the 6-check data validation.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  return json({ checks: runChecks(db, roundId) });
};
