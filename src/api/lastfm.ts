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
