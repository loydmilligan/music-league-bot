export interface League { id: number; slug: string; name: string; excludeFromCombined: boolean; notes: string | null; }
export interface Season { id: number; leagueId: number; seasonNumber: number; status: 'active' | 'complete'; }
export interface Round {
  id: number; seasonId: number; mlRoundId: string; name: string; description: string | null;
  spotifyPlaylistUrl: string | null; submissionDeadline: string | null; votingDeadline: string | null; createdAt: string;
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
export interface YtmQueueEntry {
  id: number; spotifyUri: string; title: string | null; artist: string | null;
  status: 'pending' | 'processing' | 'done' | 'failed'; error: string | null;
  queuedAt: string; resolvedAt: string | null;
}
