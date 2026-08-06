import type Database from 'better-sqlite3';
import { buildGuessMatcher, type GuessCandidate } from '../digest/guessResolver.js';

/**
 * "The Guesser" — deterministic scoring of one player's habit of guessing who
 * submitted each song from their vote comments. Detects the guesser (the
 * competitor with the most non-empty vote comments in the league), resolves
 * every comment to a roster player via `buildGuessMatcher`, and produces a
 * weekly record plus season-long leaderboards. No LLM, no network — pure SQL
 * + JS, stable ordering throughout so re-running never changes the output.
 */

export interface GuesserGuess {
  spotifyUri: string;
  title: string;
  playPosition: number;
  playCount: number;
  actualPlayerId: number | null;
  actualName: string;
  guessedPlayerId: number | null;
  guessedName: string | null;
  correct: boolean;
  /** The guesser's raw vote comment on this song (null = no comment). Consumed
   *  by the "descent" viz to mine landmark annotations. */
  comment: string | null;
}

/** One round's guess hit-rate, for the season-arc sparkbars. */
export interface GuesserSeasonPoint {
  roundId: number;
  /** Round number label for the x-axis (falls back to the round id). */
  label: string;
  correct: number;
  attempts: number;
  rate: number;
}

export interface GuesserLeaderRow {
  playerId: number;
  name: string;
  attempts: number;
  correct: number;
  rate: number;
}

export interface GuesserLittermates {
  aName: string;
  bName: string;
  swaps: number;
}

export interface GuesserData {
  guesserName: string | null;
  weekly: { attempts: number; correct: number; rate: number; guesses: GuesserGuess[] };
  drunkByThird: { first: number; middle: number; last: number };
  /** Per-round hit-rate over the season (chronological), for the season arc. */
  seasonHitRates: GuesserSeasonPoint[];
  /** Season-wide hit rate (total correct / total attempts, 0 when none). */
  seasonRate: number;
  eludesHim: GuesserLeaderRow[];
  alwaysNails: GuesserLeaderRow[];
  littermates: GuesserLittermates | null;
}

/** Minimum season attempts against a given submitter to qualify for a leaderboard. */
const MIN_ATTEMPTS = 3;

/**
 * SSSC-specific guess aliases from the design doc Appendix A (guessed text ->
 * canonical roster label). Applied in addition to competitor names and
 * player_identities identifiers. Most SSSC aliases are already covered by the
 * seeded discord identifiers; these two are the exceptions.
 */
const LEAGUE_ALIASES: Record<string, Array<{ match: string; asName: string }>> = {
  sssc: [
    { match: 'Generous Giragge', asName: 'jirafa' },
    { match: 'Cherrycola', asName: 'Cherry' },
    { match: 'Mara', asName: 'missmara' },
  ],
};

function rate(correct: number, attempts: number): number {
  return attempts > 0 ? correct / attempts : 0;
}

/** Which third of the round (by play position) a song falls in. */
function third(pos: number, n: number): 'first' | 'middle' | 'last' {
  if (n <= 0) return 'first';
  const firstEnd = Math.ceil(n / 3);
  const middleEnd = Math.ceil((2 * n) / 3);
  if (pos <= firstEnd) return 'first';
  if (pos <= middleEnd) return 'middle';
  return 'last';
}

function emptyGuesserData(): GuesserData {
  return {
    guesserName: null,
    weekly: { attempts: 0, correct: 0, rate: 0, guesses: [] },
    drunkByThird: { first: 0, middle: 0, last: 0 },
    seasonHitRates: [],
    seasonRate: 0,
    eludesHim: [],
    alwaysNails: [],
    littermates: null,
  };
}

interface SubmissionRow {
  spotify_uri: string;
  title: string;
  actual_player_id: number | null;
  actual_name: string;
}

interface VoteCommentRow {
  spotify_uri: string;
  comment: string;
}

interface SeasonGuessRow {
  round_id: number;
  round_number: number | null;
  spotify_uri: string;
  actual_player_id: number | null;
  actual_name: string;
  guess_comment: string | null;
}

export function getGuesserData(db: Database.Database, roundId: number): GuesserData {
  // 1. Resolve round -> season, league (id + slug).
  const roundRow = db
    .prepare(
      `SELECT r.id, r.season_id, r.created_at, se.league_id, l.slug
       FROM rounds r
       JOIN seasons se ON se.id = r.season_id
       JOIN leagues l ON l.id = se.league_id
       WHERE r.id = ?`,
    )
    .get(roundId) as { id: number; season_id: number; created_at: string; league_id: number; slug: string } | undefined;
  if (!roundRow) return emptyGuesserData();
  const { season_id: seasonId, created_at: roundCreatedAt, league_id: leagueId, slug } = roundRow;

  // 2. Detect the guesser: the player with the most non-empty vote comments
  // in this league. Merge on player_id so duplicate competitor rows for the
  // same person (e.g. two KarBen accounts) don't split his comment count.
  const guesserRow = db
    .prepare(
      `SELECT COALESCE(v.player_id, c.player_id) AS pid, COUNT(*) AS cnt
       FROM votes v
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons se ON se.id = r.season_id
       JOIN competitors c ON c.id = v.voter_id
       WHERE se.league_id = ? AND v.comment IS NOT NULL AND TRIM(v.comment) <> ''
       GROUP BY pid
       HAVING pid IS NOT NULL
       ORDER BY cnt DESC, pid ASC
       LIMIT 1`,
    )
    .get(leagueId) as { pid: number; cnt: number } | undefined;
  if (!guesserRow) return emptyGuesserData();
  const guesserPlayerId = guesserRow.pid;

  const guesserNameRow = db.prepare('SELECT name FROM players WHERE id = ?').get(guesserPlayerId) as
    | { name: string }
    | undefined;
  if (!guesserNameRow) return emptyGuesserData();
  const guesserName = guesserNameRow.name;

  // All competitor ids in this league that resolve to the guesser's player_id
  // (merges duplicate-competitor accounts for the same person).
  const guesserCompetitorIds = (
    db.prepare('SELECT id FROM competitors WHERE player_id = ?').all(guesserPlayerId) as { id: number }[]
  ).map((r) => r.id);
  if (guesserCompetitorIds.length === 0) return emptyGuesserData();
  const guesserIdsPlaceholder = guesserCompetitorIds.map(() => '?').join(',');

  // 3. Build the candidate roster for the league: competitor names,
  // player_identities identifiers (discord + music-league), plus any
  // league-specific alias map. Each candidate carries the resolved player_id.
  const competitorRows = db
    .prepare(
      `SELECT DISTINCT c.id AS competitor_id, c.name, c.player_id
       FROM competitors c
       JOIN votes v ON v.voter_id = c.id
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons se ON se.id = r.season_id
       WHERE se.league_id = ?
       UNION
       SELECT DISTINCT c.id AS competitor_id, c.name, c.player_id
       FROM competitors c
       JOIN ml_submissions s ON s.competitor_id = c.id
       JOIN rounds r ON r.id = s.round_id
       JOIN seasons se ON se.id = r.season_id
       WHERE se.league_id = ?
       ORDER BY 2 ASC, 1 ASC`,
    )
    .all(leagueId, leagueId) as { competitor_id: number; name: string; player_id: number | null }[];

  const candidates: GuessCandidate[] = [];
  const nameToPlayerId = new Map<string, number>();
  for (const row of competitorRows) {
    if (row.player_id === null) continue;
    candidates.push({ playerId: row.player_id, label: row.name });
    if (!nameToPlayerId.has(row.name)) nameToPlayerId.set(row.name, row.player_id);
  }

  // Only discord/music-league identifiers are human-readable handles that can
  // appear in a free-text guess comment; whatsapp/google-chat identifiers are
  // opaque phone numbers/chat ids and would never match.
  const identityRows = db
    .prepare(
      `SELECT identifier, player_id
       FROM player_identities
       WHERE identity_type IN ('discord', 'music-league')
         AND (league_id = ? OR league_id IS NULL)
       ORDER BY identifier ASC, player_id ASC`,
    )
    .all(leagueId) as { identifier: string; player_id: number }[];
  for (const row of identityRows) {
    candidates.push({ playerId: row.player_id, label: row.identifier });
  }

  for (const alias of LEAGUE_ALIASES[slug] ?? []) {
    const playerId = nameToPlayerId.get(alias.asName);
    if (playerId !== undefined) candidates.push({ playerId, label: alias.match });
  }

  // 4. Deterministic comment -> guessed-player resolver.
  const matcher = buildGuessMatcher(candidates);

  // Player id -> canonical display name, for weekly + leaderboard rows.
  // Sourced from `players` directly (not from competitorRows' competitors.name)
  // so guessedName/littermates always agree with actualName's COALESCE(p.name, c.name)
  // preference for the canonical name — otherwise the same person could render
  // under two different names (canonical when he's the actual submitter, stale
  // competitors.name when he's the guessed player), and a guess resolved only
  // via a global identity row could fall back to a raw numeric id string.
  const playerNames = new Map<number, string>(
    (db.prepare('SELECT id, name FROM players').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]),
  );
  const nameOf = (playerId: number | null): string | null =>
    playerId === null ? null : (playerNames.get(playerId) ?? null);

  // 5. Weekly: every submission in the target round, ordered by spotify_uri
  // (play order), against the guesser's vote comment (if any) on that song.
  const roundSubmissions = db
    .prepare(
      `SELECT s.spotify_uri, s.title,
              COALESCE(s.player_id, c.player_id) AS actual_player_id,
              COALESCE(p.name, c.name) AS actual_name
       FROM ml_submissions s
       LEFT JOIN competitors c ON c.id = s.competitor_id
       LEFT JOIN players p ON p.id = COALESCE(s.player_id, c.player_id)
       WHERE s.round_id = ?
       ORDER BY s.spotify_uri ASC`,
    )
    .all(roundId) as SubmissionRow[];

  // Guesser's comments in this round, keyed by spotify_uri. Ordered by
  // voter_id so a duplicate-competitor collision resolves deterministically
  // (first competitor id wins).
  const guesserVoteRows = db
    .prepare(
      `SELECT spotify_uri, comment
       FROM votes
       WHERE round_id = ? AND voter_id IN (${guesserIdsPlaceholder})
         AND comment IS NOT NULL AND TRIM(comment) <> ''
       ORDER BY voter_id ASC, spotify_uri ASC`,
    )
    .all(roundId, ...guesserCompetitorIds) as VoteCommentRow[];
  const commentByUri = new Map<string, string>();
  for (const row of guesserVoteRows) {
    if (!commentByUri.has(row.spotify_uri)) commentByUri.set(row.spotify_uri, row.comment);
  }

  const playCount = roundSubmissions.length;
  const weeklyGuesses: GuesserGuess[] = [];
  const thirdBuckets: Record<'first' | 'middle' | 'last', { attempts: number; correct: number }> = {
    first: { attempts: 0, correct: 0 },
    middle: { attempts: 0, correct: 0 },
    last: { attempts: 0, correct: 0 },
  };

  roundSubmissions.forEach((sub, idx) => {
    const playPosition = idx + 1;
    // Skip songs the guesser submitted himself — he can't guess his own.
    if (sub.actual_player_id !== null && sub.actual_player_id === guesserPlayerId) return;

    const comment = commentByUri.get(sub.spotify_uri) ?? null;
    const guessedPlayerId = comment !== null ? matcher(comment) : null;
    const guessedName = nameOf(guessedPlayerId);
    const correct = guessedPlayerId !== null && guessedPlayerId === sub.actual_player_id;

    weeklyGuesses.push({
      spotifyUri: sub.spotify_uri,
      title: sub.title,
      playPosition,
      playCount,
      actualPlayerId: sub.actual_player_id,
      actualName: sub.actual_name,
      guessedPlayerId,
      guessedName,
      correct,
      comment,
    });

    // A comment with no roster-name match is not an attempt — never counted,
    // never scored wrong.
    if (guessedPlayerId !== null) {
      const bucket = thirdBuckets[third(playPosition, playCount)];
      bucket.attempts += 1;
      if (correct) bucket.correct += 1;
    }
  });

  const weeklyAttempts = weeklyGuesses.filter((g) => g.guessedPlayerId !== null).length;
  const weeklyCorrect = weeklyGuesses.filter((g) => g.correct).length;

  const drunkByThird = {
    first: rate(thirdBuckets.first.correct, thirdBuckets.first.attempts),
    middle: rate(thirdBuckets.middle.correct, thirdBuckets.middle.attempts),
    last: rate(thirdBuckets.last.correct, thirdBuckets.last.attempts),
  };

  // 7. Season aggregate: every guesser comment across rounds in this season
  // up to and including the target round, matched against the actual
  // submitter of the same (round, spotify_uri).
  const seasonRows = db
    .prepare(
      `SELECT s.round_id, r.round_number,
              s.spotify_uri,
              COALESCE(s.player_id, c.player_id) AS actual_player_id,
              COALESCE(p.name, c.name) AS actual_name,
              v.comment AS guess_comment
       FROM votes v
       JOIN ml_submissions s ON s.round_id = v.round_id AND s.spotify_uri = v.spotify_uri
       JOIN rounds r ON r.id = v.round_id
       LEFT JOIN competitors c ON c.id = s.competitor_id
       LEFT JOIN players p ON p.id = COALESCE(s.player_id, c.player_id)
       WHERE v.voter_id IN (${guesserIdsPlaceholder})
         AND r.season_id = ? AND r.created_at <= ?
         AND v.comment IS NOT NULL AND TRIM(v.comment) <> ''
       ORDER BY r.created_at ASC, r.id ASC, v.voter_id ASC, s.spotify_uri ASC`,
    )
    .all(...guesserCompetitorIds, seasonId, roundCreatedAt) as SeasonGuessRow[];

  // Dedupe (round_id, spotify_uri) in case duplicate-competitor accounts both
  // voted on the same song in the same round — first row wins (already
  // ordered deterministically by voter_id).
  const seenKeys = new Set<string>();
  const perSubmitter = new Map<number, { name: string; attempts: number; correct: number }>();
  const pairSwaps = new Map<string, { aId: number; bId: number; aName: string; bName: string; swaps: number }>();
  // Per-round hit-rate for the season arc. Keyed by round_id; insertion order
  // follows the chronological row ordering (created_at ASC), so the arc reads
  // left→right oldest→newest. Only rounds where he made at least one real
  // attempt appear.
  const perRound = new Map<number, { label: string; attempts: number; correct: number }>();

  for (const row of seasonRows) {
    const key = `${row.round_id}:${row.spotify_uri}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    // Skip songs the guesser submitted himself.
    if (row.actual_player_id !== null && row.actual_player_id === guesserPlayerId) continue;
    if (row.actual_player_id === null) continue;

    const guessedPlayerId = row.guess_comment !== null ? matcher(row.guess_comment) : null;
    // A comment with no roster-name match is not an attempt.
    if (guessedPlayerId === null) continue;

    // Season arc: bucket this attempt into its round.
    const roundBucket =
      perRound.get(row.round_id) ??
      { label: row.round_number != null ? String(row.round_number) : String(row.round_id), attempts: 0, correct: 0 };
    roundBucket.attempts += 1;
    if (guessedPlayerId === row.actual_player_id) roundBucket.correct += 1;
    perRound.set(row.round_id, roundBucket);

    const bucket = perSubmitter.get(row.actual_player_id) ?? { name: row.actual_name, attempts: 0, correct: 0 };
    bucket.attempts += 1;
    if (guessedPlayerId === row.actual_player_id) {
      bucket.correct += 1;
    } else {
      // 8. littermates: the unordered {actual, guessed} pair he most often confuses.
      const guessedName = nameOf(guessedPlayerId) ?? String(guessedPlayerId);
      const [loId, loName, hiId, hiName] =
        row.actual_player_id < guessedPlayerId
          ? [row.actual_player_id, row.actual_name, guessedPlayerId, guessedName]
          : [guessedPlayerId, guessedName, row.actual_player_id, row.actual_name];
      const pairKey = `${loId}:${hiId}`;
      const pair = pairSwaps.get(pairKey) ?? { aId: loId, bId: hiId, aName: loName, bName: hiName, swaps: 0 };
      pair.swaps += 1;
      pairSwaps.set(pairKey, pair);
    }
    perSubmitter.set(row.actual_player_id, bucket);
  }

  const leaderRows: GuesserLeaderRow[] = [...perSubmitter.entries()]
    .filter(([, v]) => v.attempts >= MIN_ATTEMPTS)
    .map(([playerId, v]) => ({ playerId, name: v.name, attempts: v.attempts, correct: v.correct, rate: rate(v.correct, v.attempts) }));

  const eludesHim = [...leaderRows].sort((a, b) => a.rate - b.rate || b.attempts - a.attempts || a.name.localeCompare(b.name));
  const alwaysNails = [...leaderRows].sort((a, b) => b.rate - a.rate || b.attempts - a.attempts || a.name.localeCompare(b.name));

  const seasonHitRates: GuesserSeasonPoint[] = [...perRound.entries()].map(([roundId, v]) => ({
    roundId,
    label: v.label,
    correct: v.correct,
    attempts: v.attempts,
    rate: rate(v.correct, v.attempts),
  }));
  const seasonTotals = seasonHitRates.reduce(
    (acc, p) => ({ correct: acc.correct + p.correct, attempts: acc.attempts + p.attempts }),
    { correct: 0, attempts: 0 },
  );
  const seasonRate = rate(seasonTotals.correct, seasonTotals.attempts);

  let littermates: GuesserLittermates | null = null;
  const pairList = [...pairSwaps.values()].sort(
    (a, b) => b.swaps - a.swaps || a.aName.localeCompare(b.aName) || a.bName.localeCompare(b.bName),
  );
  if (pairList.length > 0) {
    const top = pairList[0];
    littermates = { aName: top.aName, bName: top.bName, swaps: top.swaps };
  }

  return {
    guesserName,
    weekly: { attempts: weeklyAttempts, correct: weeklyCorrect, rate: rate(weeklyCorrect, weeklyAttempts), guesses: weeklyGuesses },
    drunkByThird,
    seasonHitRates,
    seasonRate,
    eludesHim,
    alwaysNails,
    littermates,
  };
}
