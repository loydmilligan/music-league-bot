import type { ISpotifyAdapter } from '../music/types.js';
import type { ParsedSubmission } from '../parser/types.js';
import type { ResolutionResult } from './types.js';

const SPOTIFY_HTTPS_RE = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/;
const SPOTIFY_URI_RE = /^spotify:track:([A-Za-z0-9]+)/;
const YOUTUBE_RE = /(?:youtube\.com\/watch|youtu\.be\/)/;

export async function resolveTrack(
  submission: ParsedSubmission,
  adapter: ISpotifyAdapter,
  confidenceThreshold: number,
): Promise<ResolutionResult> {
  const { sourceUrl, artistHint, titleHint } = submission;

  if (sourceUrl) {
    const spotifyHttpsMatch = sourceUrl.match(SPOTIFY_HTTPS_RE);
    if (spotifyHttpsMatch) {
      const track = await adapter.getTrackById(spotifyHttpsMatch[1]);
      return {
        track,
        status: track ? 'found' : 'not-found',
        query: sourceUrl,
      };
    }

    const spotifyUriMatch = sourceUrl.match(SPOTIFY_URI_RE);
    if (spotifyUriMatch) {
      const track = await adapter.getTrackById(spotifyUriMatch[1]);
      return {
        track,
        status: track ? 'found' : 'not-found',
        query: sourceUrl,
      };
    }

    // TODO: distinguish 'unsupported' from 'not-found' when YouTube adapter is added
    if (YOUTUBE_RE.test(sourceUrl)) {
      return {
        track: null,
        status: 'not-found',
        query: sourceUrl,
      };
    }

    return { track: null, status: 'not-found', query: sourceUrl };
  }

  if (artistHint && titleHint) {
    const query = `${artistHint} - ${titleHint}`;
    const track = await adapter.searchTrack(query);
    if (!track) return { track: null, status: 'not-found', query };
    const status = track.confidence >= confidenceThreshold ? 'found' : 'low-confidence';
    return { track, status, query };
  }

  return { track: null, status: 'not-found', query: '' };
}
