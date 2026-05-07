import type { ResolvedTrack } from '../music/types.js';

export type ResolutionStatus = 'found' | 'low-confidence' | 'not-found';

export interface ResolutionResult {
  track: ResolvedTrack | null;
  status: ResolutionStatus;
  query: string;
}
