// Shared contract for the Voting Replay panel. All four workstreams (engine,
// data, views, tests) import from here so they can be built in parallel.
// See docs/superpowers/specs/2026-09-07-voting-replay-design.md

/** One voter's line on one song. `points` of 0 with a comment is a submitter note. */
export interface ReplayVote { uri: string; points: number; comment: string | null; }

/** One player's whole ballot, filed atomically. */
export interface ReplayBallot { voter: string; castAt: string; votes: ReplayVote[]; }

export interface ReplaySong {
  uri: string; title: string; artist: string;
  submitter: string;
  submitterComment: string | null;
}

export interface ReplayPayload {
  round: {
    id: number; name: string; description: string;
    votingDeadline: string | null;
    /** Last submission time: lower bound on when voting opened. */
    windowOpensAfter: string | null;
  };
  songs: ReplaySong[];
  ballots: ReplayBallot[];          // ordered by castAt ascending
}

export type GlanceSeverity = 1 | 2 | 3 | 4;

export interface Scenario {
  /** 1 = individual, 2 = partner, 3 = double plus. Order is irrelevant. */
  observers: string[];
  gs: GlanceSeverity;
  /** Manual (uri, player) exclusions supplied by the analyst. */
  hunches: Array<{ uri: string; player: string }>;
}

/** A contiguous run of ballots between two consecutive checkpoints. */
export interface Interval {
  voters: string[];                  // who voted in this interval, in order
  delta: Record<string, number>;     // per-song point change across the interval
  /** True when voters.length === 1, i.e. the ballot is exactly recoverable. */
  exact: boolean;
}

export interface SongBoard {
  uri: string; points: number; voterCount: number;
}

export interface SongKnowledge {
  uri: string;
  /** Sound mechanical narrowing. Always contains the true submitter. */
  mechanical: string[];
  /** After the analyst's hunches. Subset of `mechanical`. May be wrong. */
  afterHunches: string[];
  ruledOutByYou: string[];
}

export interface ReplayStep {
  index: number;                     // 0-based position in ballots[]
  ballot: ReplayBallot;
  board: SongBoard[];                // public standings AFTER this ballot
  knownBallots: string[];            // voters whose ballots are exactly known
  partialIntervals: Interval[];      // known-as-a-sum, not individually resolved
  knowledge: SongKnowledge[];
}

export interface ReplayAnalysis {
  steps: ReplayStep[];
  /** Ballots strictly between the two observers. Caps everything. */
  windowSize: number;
  observerPositions: Record<string, number>;
  /** Hunch leverage: songs resolved by hunches that mechanics alone did not. */
  hunchesApplied: number;
  songsResolvedByHunches: number;
}
