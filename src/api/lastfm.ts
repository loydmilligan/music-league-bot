const LASTFM_ROOT = 'https://ws.audioscrobbler.com/2.0/';

function toInt(value: unknown): number {
  const n = parseInt(String(value ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

export async function getLastfmTrackInfo(
  artist: string,
  track: string,
  apiKey: string
): Promise<{ listeners: number; playcount: number; error?: string }> {
  const params = new URLSearchParams({
    method: 'track.getInfo',
    api_key: apiKey,
    format: 'json',
    autocorrect: '1',
    artist: artist.trim(),
    track: track.trim(),
  });

  const res = await fetch(`${LASTFM_ROOT}?${params}`);
  if (!res.ok) return { listeners: 0, playcount: 0, error: `HTTP ${res.status}` };

  const data = await res.json() as { error?: number; message?: string; track?: { listeners?: string; playcount?: string } };
  if (data.error) return { listeners: 0, playcount: 0, error: data.message };

  const t = data.track;
  return {
    listeners: toInt(t?.listeners),
    playcount: toInt(t?.playcount),
  };
}

// sprint-17 discoverability-fix. Spotify titles carry version qualifiers
// ("- Remastered 2009", "- 2004 Remaster", "(Live ...)", "- Originally Performed
// by ...") that point track.getInfo at a low-scrobble variant entry, badly
// under/over-counting popularity. Strip those to reach the canonical track.
const TITLE_QUALIFIER =
  /\b(re-?master(ed)?|remaster|mono|stereo|mix|live|version|edit|remix|deluxe|anniversary|bonus|demo|session|take|instrumental|karaoke|originally performed|single version|radio edit|re-?record(ed)?(\s+\(?taylor'?s version\)?)?)\b/i;

export function normalizeTrackTitle(title: string): string {
  let t = (title ?? '').trim();
  // Strip a trailing " - <qualifier>" segment (Spotify's convention) when the
  // tail looks like a version marker or carries a year (e.g. "- 2004 Remaster").
  const dash = t.search(/\s+-\s+/);
  if (dash >= 0) {
    const tail = t.slice(dash);
    if (TITLE_QUALIFIER.test(tail) || /\b(19|20)\d{2}\b/.test(tail)) t = t.slice(0, dash).trim();
  }
  // Strip a trailing parenthetical/bracket qualifier: "(Remastered 2011)", "(Live ...)".
  t = t
    .replace(
      /\s*[([][^)\]]*(re-?master(ed)?|live|mono|stereo|mix|version|edit|remix|deluxe|anniversary|bonus|demo|session|instrumental|karaoke|originally performed)[^)\]]*[)\]]\s*$/i,
      '',
    )
    .trim();
  return t || (title ?? '').trim();
}

const normArtist = (s: string): string =>
  (s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '').trim();

interface LastfmSearchMatch { name: string; artist: string; listeners: number }

// Find the real track via track.search and take the highest-listener result for
// the artist — fixes split-entry undercounts (e.g. "(You Gotta) Fight for Your
// Right (To Party!)" 16k vs "Fight for Your Right" 826k).
async function searchBestTrack(artist: string, track: string, apiKey: string): Promise<LastfmSearchMatch | null> {
  const params = new URLSearchParams({
    method: 'track.search', api_key: apiKey, format: 'json', limit: '20',
    track: track.trim(), artist: artist.trim(),
  });
  const res = await fetch(`${LASTFM_ROOT}?${params}`);
  if (!res.ok) return null;
  const data = await res.json() as { results?: { trackmatches?: { track?: unknown } } };
  const raw = data.results?.trackmatches?.track;
  const list: LastfmSearchMatch[] = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((t) => {
    const r = t as { name?: string; artist?: string; listeners?: string };
    return { name: r.name ?? '', artist: r.artist ?? '', listeners: toInt(r.listeners) };
  });
  if (!list.length) return null;
  const target = normArtist(artist);
  const sameArtist = list.filter((m) => {
    const a = normArtist(m.artist);
    return a === target || a.includes(target) || target.includes(a);
  });
  const pool = sameArtist.length ? sameArtist : list;
  return pool.reduce((best, m) => (m.listeners > best.listeners ? m : best), pool[0]);
}

// Trustworthy per-song popularity: normalize the title, search for the real
// (max-scrobble) track, then read authoritative listeners+playcount via getInfo.
// Falls back to a direct getInfo on the normalized title if search finds nothing.
export async function getLastfmPopularity(
  artist: string,
  title: string,
  apiKey: string,
): Promise<{ listeners: number; playcount: number; matchedArtist: string; matchedTitle: string; error?: string }> {
  const normTitle = normalizeTrackTitle(title);
  const best = await searchBestTrack(artist, normTitle, apiKey);
  const lookupArtist = best?.artist || artist;
  const lookupTitle = best?.name || normTitle;
  const info = await getLastfmTrackInfo(lookupArtist, lookupTitle, apiKey);
  // Prefer getInfo's numbers (it carries playcount); fall back to search listeners.
  const listeners = info.listeners || best?.listeners || 0;
  return {
    listeners,
    playcount: info.playcount,
    matchedArtist: lookupArtist,
    matchedTitle: lookupTitle,
    error: info.error,
  };
}

function logNormalize(value: number, maxValue: number): number {
  if (!maxValue || maxValue <= 0) return 0;
  return (Math.log10(value + 1) / Math.log10(maxValue + 1)) * 100;
}

export function computePopularityProxies(
  rows: Array<{ listeners: number; playcount: number }>
): number[] {
  const maxPlaycount = Math.max(...rows.map(r => r.playcount), 0);
  const maxListeners = Math.max(...rows.map(r => r.listeners), 0);

  return rows.map(({ playcount, listeners }) => {
    const playScore = logNormalize(playcount, maxPlaycount);
    const listenerScore = logNormalize(listeners, maxListeners);
    if (playcount > 0 && listeners > 0) return Math.round(0.7 * playScore + 0.3 * listenerScore);
    if (playcount > 0) return Math.round(playScore);
    if (listeners > 0) return Math.round(listenerScore);
    return 0;
  });
}
