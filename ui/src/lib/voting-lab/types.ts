/** Shared types for the Voting Phase Lab. */

export interface VoteBudget {
  upTotal: number;
  downTotal: number;
  /** null = no per-song cap. */
  perSongCap: number | null;
}

export interface BallotEntry {
  spotifyUri: string;
  upPoints: number;
  downPoints: number;
  rating: number | null;
  notes: string;
  draftComment: string;
  /** The owner's own submission — never allocatable. */
  isMine: boolean;
}

export interface BudgetUsage {
  upUsed: number;
  downUsed: number;
  upRemaining: number;
  downRemaining: number;
}

/** One song in the lab, with the metadata the UI surfaces. */
export interface LabSong {
  spotifyUri: string;
  title: string;
  artist: string;
  albumArtUrl: string | null;
  spotifyPopularity: number | null;
  listeners: number | null;
  bpm: number | null;
  energy: number | null;
  hasLyrics: boolean | null;
  tags: string[];
}

export interface LabRow {
  song: LabSong;
  ballot: BallotEntry;
}

export type BudgetSource = 'round' | 'season' | 'default';

export interface LabData {
  roundId: number;
  themeName: string;
  themeDescription: string;
  budget: VoteBudget;
  budgetSource: BudgetSource;
  rows: LabRow[];
}
