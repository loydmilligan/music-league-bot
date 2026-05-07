import type { ResolvedTrack } from '../music/types.js';

export type ResolutionStatus = 'found' | 'low-confidence' | 'not-found';

export interface ResolutionResult {
  track: ResolvedTrack | null;
  status: ResolutionStatus;
  /** The search string submitted to the music API, used in notification messages. */
  query: string;
}
