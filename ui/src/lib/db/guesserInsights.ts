import type Database from 'better-sqlite3';
import { buildGuessMatcher, type GuessCandidate } from '../digest/guessResolver.js';
import { guesserPlayerOverrideFor } from '../digest/guesserSection.js';

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
  /**
   * One-line legend rendered above the ledger.
   *
   * Per-league because the SSSC copy describes a specific ritual (a drink-deeper
   * descent down the playlist) that is true of Dogsweat and of nobody else. Shown
   * verbatim in the exported PNG, so a wrong one is wrong in print.
   */
  legend: string;
  /** Which league this was built for — the component keys its copy off it. */
  leagueSlug: string;
  /** Play-order strip labels and optional joke marker. */
  descent: GuesserDescent;
  weekly: { attempts: number; correct: number; rate: number; guesses: GuesserGuess[] };
  /**
   * Correct guesses split by where the song sits in play order.
   *
   * Position only, and deliberately not labelled as fatigue. He does start at
   * the top, so play order is roughly the order he works in — but not strictly,
   * since anything that grabs him late gets done out of turn. So a low
   * last-third number records where the misses land, not reliably why.
   */
  byThird: { first: number; middle: number; last: number };
  /**
   * Per-round hit-rate for the season arc, chronological (oldest → newest),
   * capped to the most recent `SEASON_ARC_ROUNDS` rounds so the strip stays
   * readable at the 800px export width. `[]` for a league with one round and
   * no resolved guesses.
   */
  seasonHitRates: GuesserSeasonPoint[];
  /**
   * Season-wide hit rate (total correct / total attempts, 0 when none).
   * Computed over the WHOLE season, not just the rounds shown in the arc.
   */
  seasonRate: number;
  /**
   * How many rounds `seasonRate` actually averages over — i.e. every round this
   * season he made a resolvable guess in, which is >= `seasonHitRates.length`
   * once the arc is capped. Exists so the UI can never caption a whole-season
   * average with the (smaller) on-screen bar count.
   */
  seasonRoundCount: number;
  /**
   * Every submitter he has attempted this season, unfiltered and ordered by
   * season hit-rate. `eludesHim`/`alwaysNails` are the same data behind a
   * 3-attempt floor; the roster strip wants everyone, including the people he
   * has only tried once, because "who does he actually catch" is a roster
   * question and a leaderboard that hides half the league cannot answer it.
   * Each row also carries whether he got them THIS round.
   */
  roster: GuesserRosterRow[];
  eludesHim: GuesserLeaderRow[];
  alwaysNails: GuesserLeaderRow[];
  littermates: GuesserLittermates | null;
}

/**
 * Play-order strip config per league.
 *
 * SSSC's version is a drink-deeper "descent" with a joke marker; that framing is
 * true of one person and is actively wrong about anybody else, so it is data
 * rather than hardcoded markup. `marker` is null for leagues with no joke line.
 */
const DESCENTS: Record<string, GuesserDescent> = {
  default: {
    label: 'this round · the descent down the playlist',
    startLabel: 'sober · song 1',
    endLabel: 'blitzed · song {n}',
    marker: {
      atFraction: 0.56,
      label: '🐾 no-driving line',
      caption:
        'the 🐾 no-driving line marks where a dog of his approximate build would, on average, stop being trusted with the family sedan.',
      caveat:
        'Impairment extrapolated from the mean bodyweight of comparably-sized dogs; not admissible in any court, doghouse tribunal, or Music League vote dispute. Past this point Doggie walks — or asks Mrs. Doggie to drive.',
    },
  },
  'boarz-ii-men': {
    label: 'this round · by play order',
    startLabel: 'song 1',
    endLabel: 'song {n}',
    marker: null,
  },
};

/** Per-league legend for the guesser ledger; `default` is the original SSSC copy. */
const LEGENDS: Record<string, string> = {
  default:
    'He guesses the submitter of every song, every round — one drink deeper ' +
    'down the list. Nobody assigned him this. He will not be stopped.',
  'boarz-ii-men':
    'He names a submitter on every song, in the ballot comments, and then ' +
    'publishes his own scorecard. Nobody assigned him this either.',
};

export interface GuesserRosterRow {
  playerId: number;
  name: string;
  attempts: number;
  correct: number;
  rate: number;
  /** true = caught this round, false = missed, null = no attempt this round. */
  thisRound: boolean | null;
}

export interface GuesserDescent {
  label: string;
  startLabel: string;
  /** May contain `{n}`, replaced with the round's song count. */
  endLabel: string;
  marker: { atFraction: number; label: string; caption: string; caveat: string } | null;
}

/** Minimum season attempts against a given submitter to qualify for a leaderboard. */
const MIN_ATTEMPTS = 3;

/**
 * Minimum resolved guesses in a round before it counts as a round he played.
 *
 * Set to 2, not higher, on purpose: it is the smallest value that drops a round
 * carrying a single incidental name-drop, and existing tests establish that a
 * genuine 2-attempt round belongs in the arc.
 */
const MIN_ROUND_ATTEMPTS = 2;

/** How many of the most recent rounds the season-arc sparkbars show (CD §5.1). */
const SEASON_ARC_ROUNDS = 10;

/**
 * Per-league guess aliases (guessed text -> canonical roster label), applied on
 * top of competitor names and player_identities identifiers.
 *
 * These exist because people guess in nicknames, not roster names. Without them
 * the Boarz matcher resolved 1 of 9 comments in a round — only "Steiny", and
 * only because that happens to be his competitor name.
 *
 * `asName` must be the COMPETITOR name, which is what `nameToPlayerId` is keyed
 * on — not the player's display name.
 *
 * Deliberately generous and meant to grow: every round surfaces new coinages, and
 * an alias that never fires costs nothing while a missing one silently scores a
 * zero. Two rules keep that from backfiring —
 *   1. No bare "Dave". Two Daves play Boarz (Jensen and Steingart), so it can
 *      never resolve to one person.
 *   2. No bare "Black". The chat resolver's BLOCKED_TOKENS was built from exactly
 *      this collision ("back" -> Black, 26 times), and in a music league a bare
 *      colour word appears in band and song names constantly.
 * Keys of 5+ characters also match at edit-distance 1, so near-misses like
 * "pallets"/"palletz" are covered without listing every spelling.
 */
const LEAGUE_ALIASES: Record<string, Array<{ match: string; asName: string; allowShort?: boolean }>> = {
  sssc: [
    { match: 'Generous Giragge', asName: 'jirafa' },
    { match: 'Cherrycola', asName: 'Cherry' },
    { match: 'Mara', asName: 'missmara' },
  ],
  // Verified against every commented Boarz vote (7 rounds) plus the chat corpus
  // the personify spike built its own alias map from.
  'boarz-ii-men': [
    { match: 'Mashew', asName: 'Mashew' },
    { match: 'Mariani', asName: 'Mashew' },
    { match: 'Matty', asName: 'Mashew' },
    // "JB" is his everyday name in this room; "Juan Negro" is from the
    // Spanish-themed round 145 and is exactly the kind of one-off that a
    // name-only matcher can never catch.
    { match: 'JB', asName: 'Jonathan Black', allowShort: true },
    { match: 'Jon', asName: 'Jonathan Black' },
    { match: 'Jonathan', asName: 'Jonathan Black' },
    { match: 'Juan Negro', asName: 'Jonathan Black' },
    { match: 'Conor', asName: 'CJ Wookie' },
    { match: 'Connor', asName: 'CJ Wookie' },
    { match: 'Johnston', asName: 'CJ Wookie' },
    { match: 'Wookie', asName: 'CJ Wookie' },
    { match: 'Grant', asName: 'Grant Koziol' },
    { match: 'Koziol', asName: 'Grant Koziol' },
    { match: 'Kozh', asName: 'Grant Koziol' },
    { match: 'Kozhleaze', asName: 'Grant Koziol' },
    { match: 'Cozy', asName: 'Grant Koziol' },
    { match: 'Cozy oil', asName: 'Grant Koziol' },
    { match: 'Jensen', asName: 'djensen37' },
    { match: 'djensen', asName: 'djensen37' },
    { match: 'Shane', asName: 'Shane Farkas' },
    { match: 'Farkas', asName: 'Shane Farkas' },
    { match: 'Farkle', asName: 'Shane Farkas' },
    { match: 'Jimmy', asName: 'Jimmy Troy' },
    { match: 'Jimbo', asName: 'Jimmy Troy' },
    { match: 'Troy', asName: 'Jimmy Troy' },
    { match: 'Clements', asName: 'Clements' },
    { match: 'Clem', asName: 'Clements' },
    { match: 'Clammy', asName: 'Clements' },
    { match: 'Clamia', asName: 'Clements' },
    { match: 'Clemydia', asName: 'Clements' },
    { match: 'Steiny', asName: 'Steiny' },
    { match: 'Steingart', asName: 'Steiny' },
    { match: 'Darren', asName: 'Darren Paletz' },
    { match: 'Paletz', asName: 'Darren Paletz' },
    { match: 'Palletz', asName: 'Darren Paletz' },
    { match: 'Pallet', asName: 'Darren Paletz' },
    { match: 'Pellet', asName: 'Darren Paletz' },
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
    legend: LEGENDS.default,
    leagueSlug: '',
    descent: DESCENTS.default,
    weekly: { attempts: 0, correct: 0, rate: 0, guesses: [] },
    byThird: { first: 0, middle: 0, last: 0 },
    seasonHitRates: [],
    seasonRate: 0,
    seasonRoundCount: 0,
    roster: [],
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

  // 2. Pick the guesser. An explicit per-league setting wins; otherwise fall
  // back to whoever leaves the most vote comments.
  //
  // The fallback is a proxy for "the person playing the guessing game", and it
  // is wrong as soon as a chattier voter exists: in Boarz the top commenter is
  // Jon Black (64) while the person actually naming a submitter on every song is
  // Matt (49). Commenting a lot and guessing are different habits.
  const overridePlayerId = guesserPlayerOverrideFor(db, slug);

  const guesserRow = overridePlayerId !== null
    ? { pid: overridePlayerId, cnt: 0 }
    : db
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
    if (playerId !== undefined) candidates.push({ playerId, label: alias.match, allowShort: alias.allowShort });
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

  const byThird = {
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

  // Unfiltered roster + this round's result per person.
  const weeklyByPlayer = new Map<number, boolean>();
  for (const wg of weeklyGuesses) {
    if (wg.actualPlayerId != null) weeklyByPlayer.set(wg.actualPlayerId, !!wg.correct);
  }
  const roster: GuesserRosterRow[] = [...perSubmitter.entries()]
    .map(([playerId, v]) => ({
      playerId,
      name: v.name,
      attempts: v.attempts,
      correct: v.correct,
      rate: rate(v.correct, v.attempts),
      thisRound: weeklyByPlayer.has(playerId) ? (weeklyByPlayer.get(playerId) as boolean) : null,
    }))
    .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts || a.name.localeCompare(b.name));

  const eludesHim = [...leaderRows].sort((a, b) => a.rate - b.rate || b.attempts - a.attempts || a.name.localeCompare(b.name));
  const alwaysNails = [...leaderRows].sort((a, b) => b.rate - a.rate || b.attempts - a.attempts || a.name.localeCompare(b.name));

  const allRoundPoints: GuesserSeasonPoint[] = [...perRound.entries()]
    .map(([roundId, v]) => ({
      roundId,
      label: v.label,
      correct: v.correct,
      attempts: v.attempts,
      rate: rate(v.correct, v.attempts),
    }))
    // A round where exactly one comment happened to name somebody is not a
    // round he played. Boarz 145-147 each resolve a single incidental mention
    // ("well done sir, unless it's Conor") and scored 0/1, which rendered as
    // three 0% bars and dragged the season average from 48% to 43% — a record
    // of rounds he wasn't guessing in. SSSC is unaffected: its guesser comments
    // on every song, so every round clears this by an order of magnitude.
    .filter((p) => p.attempts >= MIN_ROUND_ATTEMPTS);
  // The average is a SEASON average — take totals before capping the arc, so
  // trimming the strip never silently changes the headline number.
  const seasonTotals = allRoundPoints.reduce(
    (acc, p) => ({ correct: acc.correct + p.correct, attempts: acc.attempts + p.attempts }),
    { correct: 0, attempts: 0 },
  );
  const seasonRate = rate(seasonTotals.correct, seasonTotals.attempts);
  const seasonRoundCount = allRoundPoints.length;
  const seasonHitRates = allRoundPoints.slice(-SEASON_ARC_ROUNDS);

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
    legend: LEGENDS[slug] ?? LEGENDS.default,
    leagueSlug: slug,
    descent: DESCENTS[slug] ?? DESCENTS.default,
    weekly: { attempts: weeklyAttempts, correct: weeklyCorrect, rate: rate(weeklyCorrect, weeklyAttempts), guesses: weeklyGuesses },
    byThird,
    seasonHitRates,
    seasonRate,
    seasonRoundCount,
    roster,
    eludesHim,
    alwaysNails,
    littermates,
  };
}
