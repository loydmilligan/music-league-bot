import { it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, getLeagueBySlug, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import { upsertCompetitor, upsertSubmission } from './submissions.js';

function setup() {
  const db = openLeagueDb(':memory:');
  seedLeagues(db);
  const league = getLeagueBySlug(db, 'hip-jammers')!;
  const seasonId = upsertSeason(db, league.id, 99, 'active');
  const roundId = upsertRound(db, seasonId, {
    mlRoundId: 'r-deanon',
    name: 'De-anon round',
    description: '',
    spotifyPlaylistUrl: '',
    createdAt: '2026-01-01T00:00:00Z',
  });
  return { db, roundId };
}

const URI = 'spotify:track:deadbeefdeadbeef00';

// Regression: a round imported while in-progress stores submissions with
// competitor_id IS NULL (submitter hidden). Refreshing it after completion
// must de-anonymize that row, not create a duplicate. UNIQUE(round_id,
// spotify_uri,competitor_id) treats NULL as distinct, so the naive insert
// used to leave two rows per pick.
it('de-anonymizes a NULL-competitor submission on refresh (no duplicate)', () => {
  const { db, roundId } = setup();

  // Simulate the in-progress import: anonymous row, competitor_id NULL.
  db.prepare(
    `INSERT INTO ml_submissions
       (round_id,competitor_id,spotify_uri,title,album,artists,comment,created_at,visible_to_voters)
       VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(roundId, null, URI, 'Song', 'Album', 'Artist', null, '2026-05-20T00:00:00Z', 1);

  const before = db
    .prepare('SELECT COUNT(*) n FROM ml_submissions WHERE round_id=?')
    .get(roundId) as { n: number };
  expect(before.n).toBe(1);

  // Post-completion refresh: the same pick, now with a known submitter.
  const competitorId = upsertCompetitor(db, 'ml-comp-1', 'Alice');
  upsertSubmission(db, {
    roundId,
    competitorId,
    spotifyUri: URI,
    title: 'Song',
    album: 'Album',
    artists: 'Artist',
    comment: 'great pick',
    createdAt: '2026-05-16T00:00:00Z',
    visibleToVoters: true,
  });

  const rows = db
    .prepare('SELECT competitor_id, comment FROM ml_submissions WHERE round_id=? AND spotify_uri=?')
    .all(roundId, URI) as { competitor_id: number | null; comment: string | null }[];
  expect(rows).toHaveLength(1); // de-anonymized, not duplicated
  expect(rows[0].competitor_id).toBe(competitorId);
  expect(rows[0].comment).toBe('great pick'); // refreshed fields applied
});

it('upsertSubmission is idempotent for an already-identified pick', () => {
  const { db, roundId } = setup();
  const competitorId = upsertCompetitor(db, 'ml-comp-1', 'Alice');
  const sub = {
    roundId,
    competitorId,
    spotifyUri: URI,
    title: 'Song',
    album: 'Album',
    artists: 'Artist',
    comment: 'c',
    createdAt: '2026-05-16T00:00:00Z',
    visibleToVoters: true,
  };
  upsertSubmission(db, sub);
  upsertSubmission(db, sub);
  const n = (db
    .prepare('SELECT COUNT(*) n FROM ml_submissions WHERE round_id=?')
    .get(roundId) as { n: number }).n;
  expect(n).toBe(1);
});
