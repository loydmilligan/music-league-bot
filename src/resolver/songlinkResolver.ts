const SONG_LINK_API = 'https://api.song.link/v1-alpha.1/links';

type SongLinkEntity = {
  id: string;
  type: string;
  title?: string;
  artistName?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  apiProvider: string;
  platforms: string[];
};

type SongLinkPlatformLink = {
  country: string;
  url: string;
  entityUniqueId: string;
};

type SongLinkResponse = {
  entityUniqueId: string;
  userCountry: string;
  pageUrl: string;
  entitiesByUniqueId: Record<string, SongLinkEntity>;
  linksByPlatform: Record<string, SongLinkPlatformLink>;
};

export type PlatformLinks = {
  spotify?: string;
  spotifyUri?: string;
  appleMusic?: string;
  youtube?: string;
  youtubeMusic?: string;
  tidal?: string;
  deezer?: string;
  amazonMusic?: string;
  pandora?: string;
  songLink?: string;
};

export type SonglinkResolvedTrack = {
  sourceUrl: string;
  title?: string;
  artist?: string;
  thumbnail?: string;
  links: PlatformLinks;
};

export type SonglinkResolveError = {
  sourceUrl: string;
  error: string;
  links: PlatformLinks;
};

export type SonglinkResolveResult = SonglinkResolvedTrack | SonglinkResolveError;

export function normalizeSonglinkInput(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('spotify:track:')) {
    const trackId = trimmed.replace('spotify:track:', '');
    return `https://open.spotify.com/track/${trackId}`;
  }
  return trimmed;
}

export function spotifyUrlToUri(url: string | undefined): string | undefined {
  const match = url?.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  return match ? `spotify:track:${match[1]}` : undefined;
}

function getPrimaryEntity(data: SongLinkResponse): SongLinkEntity | undefined {
  const entities = Object.values(data.entitiesByUniqueId ?? {});
  return entities.find((entity) => entity.type === 'song') ?? entities[0];
}

function extractLinks(data: SongLinkResponse): PlatformLinks {
  const spotifyUrl = data.linksByPlatform.spotify?.url;
  return {
    songLink: data.pageUrl,
    spotify: spotifyUrl,
    spotifyUri: spotifyUrlToUri(spotifyUrl),
    appleMusic: data.linksByPlatform.appleMusic?.url,
    youtube: data.linksByPlatform.youtube?.url,
    youtubeMusic: data.linksByPlatform.youtubeMusic?.url,
    tidal: data.linksByPlatform.tidal?.url,
    deezer: data.linksByPlatform.deezer?.url,
    amazonMusic: data.linksByPlatform.amazonMusic?.url,
    pandora: data.linksByPlatform.pandora?.url,
  };
}

export async function resolveSonglinkUrl(input: string): Promise<SonglinkResolveResult> {
  const normalizedInput = normalizeSonglinkInput(input);
  if (!normalizedInput) {
    return { sourceUrl: input, links: {}, error: 'Missing music URL' };
  }
  try {
    const response = await fetch(`${SONG_LINK_API}?url=${encodeURIComponent(normalizedInput)}`);
    if (!response.ok) {
      return {
        sourceUrl: input,
        links: {},
        error: response.status === 404
          ? 'Track not found on Songlink/Odesli'
          : `Songlink/Odesli API error: ${response.status}`,
      };
    }
    const data = await response.json() as SongLinkResponse;
    const primaryEntity = getPrimaryEntity(data);
    return {
      sourceUrl: input,
      title: primaryEntity?.title,
      artist: primaryEntity?.artistName,
      thumbnail: primaryEntity?.thumbnailUrl,
      links: extractLinks(data),
    };
  } catch (error) {
    return {
      sourceUrl: input,
      links: {},
      error: error instanceof Error ? error.message : 'Unknown Songlink/Odesli error',
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Default delayMs is 6000 — stays safely under the 10 calls/minute public API limit.
export async function resolveSonglinkBatch(
  inputs: string[],
  options: { limit?: number; delayMs?: number } = {},
): Promise<SonglinkResolveResult[]> {
  const limit = Math.min(options.limit ?? 10, 10);
  const delayMs = options.delayMs ?? 6000;
  const inputsToProcess = inputs.slice(0, limit);
  const results: SonglinkResolveResult[] = [];
  for (const input of inputsToProcess) {
    results.push(await resolveSonglinkUrl(input));
    if (delayMs > 0) await delay(delayMs);
  }
  return results;
}
