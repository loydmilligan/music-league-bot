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
