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

/**
 * One player's guessing in one round. `attempts` counts comments that resolved
 * to a roster player; a round where they commented and named nobody is not a
 * cell, it is absent.
 */
export interface GuesserGridCell {
  roundId: number;
  attempts: number;
  correct: number;
  /**
   * Hand-authored replacement for the "n/m" the cell would otherwise print, from
   * `guesser_content_json.gridNotes`. Boarz R149 is the case that needs it:
   * Jensen guessed "Conor" on all nine songs in nine different spellings, six of
   * which resolve to nobody, so the computed 1/3 is both wrong and not the joke.
   */
  display: string | null;
  /** Optional footnote rendered under the grid, same source as `display`. */
  note: string | null;
}

/** One resolved guess, for the row's hover history. */
export interface GuesserGridGuess {
  roundLabel: string;
  guessedName: string;
  actualName: string;
  correct: boolean;
}

export interface GuesserGridRow {
  playerId: number;
  name: string;
  attempts: number;
  correct: number;
  /** One entry per round in `rounds`, null where they guessed nothing. */
  cells: (GuesserGridCell | null)[];
  /** Every guess they made, chronological — the row's tooltip text. */
  guesses: GuesserGridGuess[];
}

/**
 * Every player's guessing across the season — the ledger widened from one
 * player to the whole room.
 *
 * Rows are sorted by volume, and players who have NEVER guessed are kept with
 * an empty row on purpose: four Boarz players have never once named a submitter,
 * and an absent row would read as missing data rather than as the finding.
 */
export interface GuesserGrid {
  rounds: { roundId: number; label: string }[];
  rows: GuesserGridRow[];
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
  /** The whole room's guessing, round by round. */
  seasonGrid: GuesserGrid;
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
  'second-best': {
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
  'second-best':
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
  /** Every attempt against this person, oldest first — what the bar is made of. */
  songs: { roundId: number; roundLabel: string; title: string; correct: boolean }[];
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
const LEAGUE_ALIASES: Record<
  string,
  Array<{ match: string; asName: string; allowShort?: boolean; exactOnly?: boolean }>
> = {
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
    // "patty cakes" (Jimmy, R153) is one edit from "Matty" and is not in the
    // common-word list, so it resolved as a guess of Matt until this flag.
    { match: 'Matty', asName: 'Mashew', exactOnly: true },
    // "JB" is his everyday name in this room; "Juan Negro" is from the
    // Spanish-themed round 145 and is exactly the kind of one-off that a
    // name-only matcher can never catch.
    { match: 'JB', asName: 'Jonathan Black', allowShort: true },
    { match: 'Jon', asName: 'Jonathan Black' },
    { match: 'Jonathan', asName: 'Jonathan Black' },
    { match: 'Juan Negro', asName: 'Jonathan Black' },
    { match: 'Conor', asName: 'CJ Wookie' },
    { match: 'Connor', asName: 'CJ Wookie' },
    // R150 "Conie no play right" — two substitutions from "Conor", so exact-only.
    { match: 'Conie', asName: 'CJ Wookie', exactOnly: true },
    { match: 'Johnston', asName: 'CJ Wookie' },
    { match: 'Wookie', asName: 'CJ Wookie' },
    { match: 'Grant', asName: 'Grant Koziol' },
    { match: 'Koziol', asName: 'Grant Koziol' },
    { match: 'Kozh', asName: 'Grant Koziol' },
    // R150: "koshel" is 3 edits from "Koziol" and 2 from "Kozh", so no amount of
    // fuzz reaches it — a correct guess scored as a zero until it was listed.
    { match: 'Koshel', asName: 'Grant Koziol', exactOnly: true },
    { match: 'Koz', asName: 'Grant Koziol' },
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
    // Four characters, so fuzzy can never reach it from "Clammy"/"Clamia" (the
    // typed run has to be 5+ to fuzz at all). R150 lost a resolution to this.
    { match: 'Clam', asName: 'Clements' },
    { match: 'Clammy', asName: 'Clements' },
    { match: 'Clamia', asName: 'Clements' },
    { match: 'Clemydia', asName: 'Clements' },
    { match: 'Steiny', asName: 'Steiny' },
    { match: 'Steingart', asName: 'Steiny' },
    // Resolves today only by edit-distance-1 off "Steiny"; listed exactly so it
    // cannot be lost if "stein" ever lands in the English word list.
    { match: 'Stein', asName: 'Steiny', exactOnly: true },
    { match: 'Darren', asName: 'Darren Paletz' },
    { match: 'Paletz', asName: 'Darren Paletz' },
    { match: 'Palletz', asName: 'Darren Paletz' },
    { match: 'Pallet', asName: 'Darren Paletz' },
    // Spelled out because "pallets" is an ordinary English word: the resolver
    // refuses to FUZZY-match real words to names (that is how "rant" became
    // "Grant"), so any word-shaped nickname has to be listed exactly.
    { match: 'Pallets', asName: 'Darren Paletz' },
    { match: 'Pellet', asName: 'Darren Paletz' },
    // Season 2 newcomers (R167): Ron Bertolina plays as "Ronnie B" and is
    // "Berto(s)" in the room; Brian Grushkin plays as "Bagel Shop".
    { match: 'Berto', asName: 'Ronnie B' },
    { match: 'Bertos', asName: 'Ronnie B', exactOnly: true },
    { match: 'Bertolina', asName: 'Ronnie B' },
    { match: 'Grushkin', asName: 'Bagel Shop' },
    { match: 'Grush', asName: 'Bagel Shop' },
    // S2 R2 (round 168) coinages, each too far from a name for fuzz to reach.
    { match: 'Grushfriend', asName: 'Bagel Shop', exactOnly: true },
    { match: 'conorific', asName: 'CJ Wookie', exactOnly: true },
    { match: 'Falleetz', asName: 'Darren Paletz', exactOnly: true },
    { match: 'Jensownian', asName: 'djensen37', exactOnly: true },
    // S2 R4 (round 170): Matt's "Stenson" for Jensen, a correct guess that reached nobody.
    { match: 'Stenson', asName: 'djensen37', exactOnly: true },
    // S2 R3 (round 169) coinages.
    { match: 'farkasian', asName: 'Shane Farkas', exactOnly: true },
    { match: 'Grushfire', asName: 'Bagel Shop', exactOnly: true },
    { match: 'hanclammy', asName: 'Clements', exactOnly: true },
  ],
  // Second Best is a family league, so it collides on surnames the way Boarz
  // collides on "Dave". Four names are deliberately absent:
  //   - "Black": Jon, Sarah, Susan and Michael Black all play, and the word is
  //     everywhere in music anyway (Frank Black, Black Sabbath).
  //   - "Chapin": Phil, Jac and Tommy all play.
  //   - "Mariani": Matt and Mara both play.
  //   - bare "Michael"/"Mike": Michael Layous and Michael Black both play.
  // "Sarah" is left to the competitor roster, where it is Sarah Zucker's own
  // name; Sarah Black is "Sarah S", so write "Sarah Z"/"Zucker" when the
  // possessive would otherwise be ambiguous.
  'second-best': [
    { match: 'Matt', asName: 'Mashew' },
    { match: 'Matty', asName: 'Mashew' },
    { match: 'JB', asName: 'Jonathan Black', allowShort: true },
    { match: 'Jon', asName: 'Jonathan Black' },
    { match: 'Jonathan', asName: 'Jonathan Black' },
    { match: 'Layous', asName: 'Michael Layous' },
    { match: 'Mikey', asName: 'Michael Layous' },
    { match: 'Mike Layous', asName: 'Michael Layous' },
    { match: 'Michael Black', asName: 'monicac1217' },
    { match: 'Mike Black', asName: 'monicac1217' },
    { match: 'Monica', asName: 'monicac1217' },
    { match: 'Zucker', asName: 'Sarah' },
    // R182: "Zuck cause...obviously zuck" was a correct guess that reached nobody.
    { match: 'Zuck', asName: 'Sarah', exactOnly: true },
    { match: 'Sarah Z', asName: 'Sarah', exactOnly: true },
    { match: 'SZ', asName: 'Sarah', allowShort: true },
    // "Sarah S" was her old handle and no longer exists as a competitor, so this
    // alias silently resolved nothing. She is Queen0Reno now.
    { match: 'Sarah Black', asName: 'Queen0Reno' },
    // R181: "Sarah B" fell through to Zucker's bare "Sarah", and the fuzzy rule
    // let "Sarah Z" claim it too ("sarahb" is one edit from "sarahz"). Both
    // two-letter Sarahs are exact-only for that reason.
    { match: 'Sarah B', asName: 'Queen0Reno', exactOnly: true },
    { match: 'MB', asName: 'monicac1217', allowShort: true },
    { match: 'JP', asName: 'JohnPaul Rodriguez', allowShort: true },
    // Mara won S2. Re-point this when a new champion is crowned.
    { match: 'defending champ', asName: 'missmara', exactOnly: true },
    { match: 'Susan', asName: 'SusieQ' },
    { match: 'Susie', asName: 'SusieQ' },
    { match: 'Suz', asName: 'SusieQ' },
    { match: 'Suzy', asName: 'SusieQ' },
    { match: 'TJ', asName: 'Tj', allowShort: true },
    { match: 'TJ Cook', asName: 'Tj' },
    { match: 'Cook', asName: 'Tj' },
    { match: 'BP', asName: 'Voltron’s YoungLion', allowShort: true },
    { match: 'Brian', asName: 'Voltron’s YoungLion' },
    { match: 'Pascoe', asName: 'Voltron’s YoungLion' },
    { match: 'Voltron', asName: 'Voltron’s YoungLion' },
    { match: 'YoungLion', asName: 'Voltron’s YoungLion' },
    { match: 'Jac Chapin', asName: 'jac' },
    { match: 'Phil', asName: 'Philip Chapin' },
    { match: 'Philip', asName: 'Philip Chapin' },
    { match: 'Tommy Chapin', asName: 'Tommy' },
    // "Tom" alone is Tom Petty in this league far more often than it is Tommy.
    { match: 'Joe', asName: 'Joe Quinto' },
    { match: 'Quinto', asName: 'Joe Quinto' },
    { match: 'Mara', asName: 'missmara' },
    { match: 'Molly', asName: 'Mollyjohnson' },
    { match: 'Molly Johnson', asName: 'Mollyjohnson' },
    { match: 'Hanh', asName: 'hanhquach' },
    { match: 'Hanh Quach', asName: 'hanhquach' },
  ],
};

/**
 * Play-order round where the room began playing Guess the Submitter.
 *
 * Most leagues have played from their first round, so the default remains 1.
 * Boarz introduced the game in round five of its FIRST season; including rounds
 * one through four would turn ordinary name mentions in vote comments into
 * phantom guesses. Only applies to season 1 — later seasons start fresh at 1.
 */
const SEASON_GRID_START_ROUND: Record<string, number> = {
  'boarz-ii-men': 5,
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
    seasonGrid: { rounds: [], rows: [] },
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
  title: string | null;
  actual_player_id: number | null;
  actual_name: string;
  guess_comment: string | null;
}



/**
 * Hand-authored per-cell overrides, from the draft's `guesser_content_json`.
 *
 * Keyed "<playerId>:<roundId>". Exists because the matcher cannot see a joke
 * ballot: in Boarz R149 Jensen wrote "Conor" on all nine songs in nine different
 * spellings ("Conr?", "Cnr?", "Cronar?", "C"), six of which resolve to nobody.
 * The computed 1/3 is not what happened and not the joke, so the cell can be
 * overwritten by hand. A malformed blob degrades to no overrides.
 */
function gridNotesFor(
  db: Database.Database,
  roundId: number,
): Record<string, { display?: string; note?: string; exclude?: boolean }> {
  try {
    const row = db
      .prepare('SELECT guesser_content_json FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1')
      .get(roundId) as { guesser_content_json?: string } | undefined;
    if (!row?.guesser_content_json) return {};
    const parsed = JSON.parse(row.guesser_content_json) as {
      gridNotes?: Record<string, { display?: string; note?: string; exclude?: boolean }>;
    };
    return parsed?.gridNotes && typeof parsed.gridNotes === 'object' ? parsed.gridNotes : {};
  } catch {
    return {};
  }
}

/**
 * Every player's guesses across the league, round by round.
 *
 * Uses the same matcher and the same candidate roster as the single-guesser
 * ledger, so a cell here can never disagree with the weekly record above it.
 * A voter's comment on their OWN song is skipped — naming yourself is not a
 * guess — matching `weekly`'s self-submission rule.
 */
function buildSeasonGrid(
  db: Database.Database,
  seasonId: number,
  leagueSlug: string,
  matcher: (comment: string) => number | null,
  playerNames: Map<number, string>,
  rosterPlayerIds: readonly number[],
  // `exclude: true` drops a voter's matched comments for that round (a name
  // mentioned in a joke, not a guess) — the cell keeps its display/note.
  gridNotes: Record<string, { display?: string; note?: string; exclude?: boolean }>,
): GuesserGrid {
  const allRoundRows = db
    .prepare(
      `SELECT r.id AS roundId
       FROM rounds r
       WHERE r.season_id = ?
         AND EXISTS (SELECT 1 FROM votes v WHERE v.round_id = r.id AND TRIM(COALESCE(v.comment,'')) <> '')
       -- Play order, not id order: ids are assigned at import, so Boarz R153
       -- (closed 2026-09-03) sorts after R150 and R151 and the grid rendered a
       -- past round as if it came after them.
       ORDER BY COALESCE(r.voting_deadline, r.submission_deadline, r.created_at) ASC, r.id ASC`,
    )
    .all(seasonId) as { roundId: number }[];
  const seasonNumber =
    (db.prepare('SELECT season_number AS n FROM seasons WHERE id = ?').get(seasonId) as { n: number } | undefined)?.n ?? 1;
  const startRound = seasonNumber === 1 ? Math.max(1, SEASON_GRID_START_ROUND[leagueSlug] ?? 1) : 1;
  const roundRows = allRoundRows
    .map((row, index) => ({ ...row, label: String(index + 1) }))
    .filter((_, index) => index + 1 >= startRound);
  if (roundRows.length === 0) return { rounds: [], rows: [] };

  const voteRows = db
    .prepare(
      `SELECT v.round_id AS roundId,
              COALESCE(v.player_id, c.player_id) AS voterPlayerId,
              COALESCE(s.player_id, sc.player_id) AS actualPlayerId,
              v.comment AS comment
       FROM votes v
       JOIN rounds r ON r.id = v.round_id
       JOIN seasons se ON se.id = r.season_id
       JOIN competitors c ON c.id = v.voter_id
       LEFT JOIN ml_submissions s ON s.round_id = v.round_id AND s.spotify_uri = v.spotify_uri
       LEFT JOIN competitors sc ON sc.id = s.competitor_id
       WHERE se.id = ? AND TRIM(COALESCE(v.comment,'')) <> ''
       ORDER BY v.round_id ASC, voterPlayerId ASC, v.spotify_uri ASC`,
    )
    .all(seasonId) as {
      roundId: number;
      voterPlayerId: number | null;
      actualPlayerId: number | null;
      comment: string;
    }[];

  const includedRoundIds = new Set(roundRows.map((r) => r.roundId));
  const labelOf = new Map(roundRows.map((r) => [r.roundId, r.label]));

  // Every player who has voted this season, so the never-guessed rows survive.
  const seen = new Map<number, Map<number, { attempts: number; correct: number }>>();
  const detail = new Map<number, GuesserGridGuess[]>();
  for (const playerId of rosterPlayerIds) {
    seen.set(playerId, new Map());
    detail.set(playerId, []);
  }
  for (const row of voteRows) {
    if (!includedRoundIds.has(row.roundId)) continue;
    if (row.voterPlayerId === null) continue;
    if (!seen.has(row.voterPlayerId)) seen.set(row.voterPlayerId, new Map());
    if (!detail.has(row.voterPlayerId)) detail.set(row.voterPlayerId, []);
    if (row.actualPlayerId !== null && row.actualPlayerId === row.voterPlayerId) continue;
    if (gridNotes[`${row.voterPlayerId}:${row.roundId}`]?.exclude) continue;
    const guessed = matcher(row.comment);
    if (guessed === null) continue;
    const perRound = seen.get(row.voterPlayerId)!;
    const cell = perRound.get(row.roundId) ?? { attempts: 0, correct: 0 };
    cell.attempts += 1;
    const hit = row.actualPlayerId !== null && guessed === row.actualPlayerId;
    if (hit) cell.correct += 1;
    perRound.set(row.roundId, cell);
    detail.get(row.voterPlayerId)!.push({
      roundLabel: labelOf.get(row.roundId) ?? String(row.roundId),
      guessedName: playerNames.get(guessed) ?? String(guessed),
      actualName:
        row.actualPlayerId !== null ? (playerNames.get(row.actualPlayerId) ?? '—') : '—',
      correct: hit,
    });
  }

  const rows: GuesserGridRow[] = [];
  for (const [playerId, perRound] of seen) {
    const cells = roundRows.map(({ roundId }) => {
      const hit = perRound.get(roundId);
      const override = gridNotes[`${playerId}:${roundId}`];
      if (!hit && !override) return null;
      return {
        roundId,
        attempts: hit?.attempts ?? 0,
        correct: hit?.correct ?? 0,
        display: override?.display ?? null,
        note: override?.note ?? null,
      };
    });
    rows.push({
      playerId,
      name: playerNames.get(playerId) ?? String(playerId),
      attempts: cells.reduce((n, c) => n + (c?.attempts ?? 0), 0),
      correct: cells.reduce((n, c) => n + (c?.correct ?? 0), 0),
      cells,
      guesses: detail.get(playerId) ?? [],
    });
  }

  // Most prolific first; the never-guessed tail keeps a stable alphabetical order
  // so the empty rows read as a deliberate block rather than leftovers.
  rows.sort((a, b) =>
    b.attempts - a.attempts || b.correct - a.correct || a.name.localeCompare(b.name),
  );

  // Columns are numbered 1..N in chronological order, NOT by round id or
  // round_number: every Boarz round_number is NULL so the id leaked through, and
  // a column headed "135" means nothing to a reader. The header cell above the
  // names carries the word "Round" so the numbers are legible without a key.
  return {
    rounds: roundRows.map((r) => ({ roundId: r.roundId, label: r.label })),
    rows,
  };
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
    if (playerId !== undefined)
      candidates.push({ playerId, label: alias.match, allowShort: alias.allowShort, exactOnly: alias.exactOnly });
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
  // The grid's roster is this season's voters + submitters only — a fresh start each season
  // (the matcher above still knows every league name, past players included).
  const rosterPlayerIds = (
    db
      .prepare(
        `SELECT DISTINCT COALESCE(v.player_id, c.player_id) AS pid
         FROM votes v
         JOIN rounds r ON r.id = v.round_id
         JOIN competitors c ON c.id = v.voter_id
         WHERE r.season_id = ? AND COALESCE(v.player_id, c.player_id) IS NOT NULL
         UNION
         SELECT DISTINCT c.player_id AS pid
         FROM ml_submissions m
         JOIN rounds r ON r.id = m.round_id
         JOIN competitors c ON c.id = m.competitor_id
         WHERE r.season_id = ? AND c.player_id IS NOT NULL`,
      )
      .all(seasonId, seasonId) as { pid: number }[]
  ).map((row) => row.pid);
  const seasonGrid = buildSeasonGrid(
    db,
    seasonId,
    slug,
    matcher,
    playerNames,
    rosterPlayerIds,
    gridNotesFor(db, roundId),
  );
  const gameRoundIds = new Set(seasonGrid.rounds.map((round) => round.roundId));

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
              s.spotify_uri, s.title,
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

  const songsBySubmitter = new Map<number, { roundId: number; roundLabel: string; title: string; correct: boolean }[]>();

  for (const row of seasonRows) {
    if (!gameRoundIds.has(row.round_id)) continue;
    const key = `${row.round_id}:${row.spotify_uri}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    // Skip songs the guesser submitted himself.
    if (row.actual_player_id !== null && row.actual_player_id === guesserPlayerId) continue;
    if (row.actual_player_id === null) continue;

    const guessedPlayerId = row.guess_comment !== null ? matcher(row.guess_comment) : null;
    // A comment with no roster-name match is not an attempt.
    if (guessedPlayerId === null) continue;

    const roundLabel = row.round_number != null ? String(row.round_number) : String(row.round_id);
    const songList = songsBySubmitter.get(row.actual_player_id) ?? [];
    songList.push({
      roundId: row.round_id,
      roundLabel,
      title: row.title ?? '',
      correct: guessedPlayerId === row.actual_player_id,
    });
    songsBySubmitter.set(row.actual_player_id, songList);

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
      songs: [...(songsBySubmitter.get(playerId) ?? [])].sort((a, b) => a.roundId - b.roundId),
    }))
    .sort((a, b) => b.rate - a.rate || b.attempts - a.attempts || a.name.localeCompare(b.name));

  const eludesHim = [...leaderRows].sort((a, b) => a.rate - b.rate || b.attempts - a.attempts || a.name.localeCompare(b.name));
  const alwaysNails = [...leaderRows].sort((a, b) => b.rate - a.rate || b.attempts - a.attempts || a.name.localeCompare(b.name));

  const everyRoundPoint: GuesserSeasonPoint[] = [...perRound.entries()]
    .map(([roundId, v]) => ({
      roundId,
      label: v.label,
      correct: v.correct,
      attempts: v.attempts,
      rate: rate(v.correct, v.attempts),
    }))
    ;

  // Bars only: a rate drawn from one attempt is noise, not a trend.
  const allRoundPoints = everyRoundPoint.filter((p) => p.attempts >= MIN_ROUND_ATTEMPTS);
  // The average is a SEASON average over every real guess, INCLUDING rounds too
  // thin to draw a bar for. A lone guess is still a guess — "¿Esto fue de Juan
  // Negro?" names a submitter and was wrong — so it belongs in the record even
  // though a one-sample hit-rate makes a meaningless bar. Hence: totals from
  // everything, bars from the rounds that can carry one.
  const seasonTotals = everyRoundPoint.reduce(
    (acc, p) => ({ correct: acc.correct + p.correct, attempts: acc.attempts + p.attempts }),
    { correct: 0, attempts: 0 },
  );
  const seasonRate = rate(seasonTotals.correct, seasonTotals.attempts);
  const seasonRoundCount = everyRoundPoint.length;
  const seasonHitRates = allRoundPoints.slice(-SEASON_ARC_ROUNDS);

  let littermates: GuesserLittermates | null = null;
  const pairList = [...pairSwaps.values()].sort(
    (a, b) => b.swaps - a.swaps || a.aName.localeCompare(b.aName) || a.bName.localeCompare(b.bName),
  );
  // A "recurring mix-up" needs repetition and a clear leader: with every wrong
  // guess tied at ×1 (any first round), the top pair was just alphabetical.
  if (pairList.length > 0 && pairList[0].swaps >= 2 && (pairList.length === 1 || pairList[1].swaps < pairList[0].swaps)) {
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
    seasonGrid,
  };
}
