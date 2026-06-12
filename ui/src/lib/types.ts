export interface League { id: number; slug: string; name: string; excludeFromCombined: boolean; notes: string | null; }
export interface Season { id: number; leagueId: number; seasonNumber: number; status: 'active' | 'complete'; }
export type RoundPhase = 'upcoming' | 'submission' | 'voting' | 'archive';
export interface Round {
  id: number; seasonId: number; mlRoundId: string; name: string; description: string | null;
  spotifyPlaylistUrl: string | null; submissionDeadline: string | null; votingDeadline: string | null; createdAt: string;
  phase?: RoundPhase;
  tag?: string | null; themeSubmittedBy?: number | null; roundNumber?: number | null;
}
export interface Competitor { id: number; mlCompetitorId: string; name: string; }
export interface MlSubmission {
  id: number; roundId: number; competitorId: number; spotifyUri: string; title: string;
  album: string | null; artists: string; comment: string | null; createdAt: string;
  visibleToVoters: boolean; totalPoints?: number; rank?: number; submitterName?: string;
}
export interface ResearchSong {
  id: number; roundId: number; spotifyUri: string; title: string; artist: string;
  album: string | null; addedAt: string; notes: string | null;
  themeFit: number | null; discoveryPotential: number | null;
  nostalgiaPotential: number | null; personalRating: number | null;
  saveForFuture: boolean; submittedByMe: boolean; submittedByOther: boolean;
  otherSubmissionVotes: number | null; score?: number | null;
}
export interface Settings { weightDiscovery: number; weightThemeFit: number; weightPersonal: number; weightNostalgia: number; }
export interface ImportLogEntry {
  id: number; leagueSlug: string; seasonNumber: number; filename: string; importedAt: string;
  roundsCount: number; submissionsCount: number; votesCount: number;
  status: 'success' | 'partial' | 'error'; error: string | null;
}
export interface H2HMatch {
  id: number;
  roundId: number;
  winnerId: number;
  loserId: number;
  createdAt: string;
}
export interface H2HCandidate {
  id: number;
  roundId: number;
  artist: string;
  title: string;
  spotifyUri: string;
  ytmUrl: string | null;
  themeFit: number | null;
  discoveryPotential: number | null;
  nostalgiaPotential: number | null;
  personalRating: number | null;
  notes: string | null;
  weightedScore: number | null;
  status: string;
}
export interface H2HState {
  candidates: H2HCandidate[];
  matches: H2HMatch[];
  champion: H2HCandidate | null;
  challenger: H2HCandidate | null;
  queue: H2HCandidate[];
  retired: H2HCandidate[];
  isComplete: boolean;
}
export interface YtmQueueEntry {
  id: number; spotifyUri: string; title: string | null; artist: string | null;
  status: 'pending' | 'processing' | 'done' | 'failed'; error: string | null;
  queuedAt: string; resolvedAt: string | null;
}
export interface ShortlistSong {
  id: string;
  spotifyUri: string;
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  durationSec: number | null;
  albumArtUrl: string | null;
  addedAt: string;
  ratingDiscovery: number;
  ratingThemeFit: number;
  ratingNostalgia: number;
  ratingPersonal: number;
  submittedElsewhere: boolean;
  notes: string;
  assignments?: ShortlistAssignment[];
}
export interface ShortlistAssignment {
  shortlistSongId: string;
  roundId: number;
  assignedAt: string;
}
