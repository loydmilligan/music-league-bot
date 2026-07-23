export interface SongStanding {
  rank: number;
  points: number;
  spotifyUri: string;
  title: string;
  artist: string;
  submitterIsOwner: boolean;
  popularity: number | null;
  listeners: number | null;
}
export interface PodiumCellar { podium: SongStanding[]; cellar: SongStanding[]; }
export type BucketKey = 'mainstream' | 'mid' | 'obscure' | 'unknown';
export interface Bucket { key: BucketKey; label: string; n: number; avgPoints: number; }
export type ScoringType = 'downvotes' | 'upvote-only';

export interface ExposurePlayer { playerId: number; name: string; }
export interface Exposure {
  submissionId: number; roundId: number; title: string; artist: string;
  seenBy: ExposurePlayer[]; recognizable: boolean;
}

export interface ThemeMatch {
  roundId: number; leagueId: number; leagueName: string; seasonLabel: string;
  title: string; exactness: 'exact' | 'related'; reason: string;
}

export interface SynthesisInput {
  themeText: string;
  runs: Array<{ label: string; standings: SongStanding[]; comments: Array<{ title: string; points: number; comment: string }> }>;
}
export interface Synthesis {
  winnerDna: string; cellarTraps: string; whatToSubmit: string; songLanguages: Record<string, string>;
}

export interface MatchedRun {
  roundId: number; leagueName: string; seasonLabel: string; title: string;
  subs: number; scoring: ScoringType; exactness: 'exact' | 'related'; reason: string;
  standings: SongStanding[]; podium: SongStanding[]; cellar: SongStanding[];
}
export interface ThemeBrief {
  roundId: number; themeTitle: string; themeText: string; leagueSlug: string;
  runCount: number; firstTime: boolean;
  matches: MatchedRun[];
  familiarity: Bucket[];
  winnerDna: string; cellarTraps: string; whatToSubmit: string;
  alreadyPlayed: Exposure[];
  songLanguages: Record<string, string>;
  generatedAt: string;
}
