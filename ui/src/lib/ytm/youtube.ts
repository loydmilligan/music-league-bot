/**
 * The slice of the YouTube Data API bot-ui needs to build a playlist at
 * approval time.
 *
 * scripts/ytm-drop/run.mjs has its own copy of this because it runs on the host
 * as plain ESM. Duplicating it is the lesser evil: the alternative is either a
 * new host service for bot-ui to call, or making "OK" wait up to 15 minutes for
 * the next timer tick. Both are worse than forty lines of fetch.
 *
 * The retry and pacing rules are NOT incidental — see spike 003 and the
 * 2026-09-06 incident referenced in run.mjs.
 */

export interface YoutubeCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function credsFromEnv(env: Record<string, string | undefined> = process.env): YoutubeCreds | null {
  const { YOUTUBE_CLIENT_ID: clientId, YOUTUBE_CLIENT_SECRET: clientSecret, YOUTUBE_REFRESH_TOKEN: refreshToken } = env;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function accessToken(creds: YoutubeCreds, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }).toString(),
  });
  if (!res.ok) throw new Error(`YouTube token refresh HTTP ${res.status}`);
  return (await res.json()).access_token as string;
}

async function api(
  token: string, path: string, payload: unknown, fetchFn: typeof fetch, sleep: (ms: number) => Promise<void>, tries = 5,
): Promise<any> {
  for (let i = 0; ; i++) {
    const res = await fetchFn(`https://www.googleapis.com/youtube/v3/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (res.ok) return body;
    // 409: playlistItems.insert intermittently conflicts on rapid inserts
    // (spike 003). 429: playlists.insert has a SHORT-WINDOW burst limit that is
    // separate from the daily quota — it fired for real on 2026-09-07 and, not
    // being retried, failed the whole approval. It is the one status here that
    // backing off actually fixes, so it gets a longer wait.
    const retryable = [409, 429, 500, 503].includes(res.status);
    if (!retryable || i >= tries - 1) {
      throw new Error(`${path.split('?')[0]} HTTP ${res.status}: ${JSON.stringify(body?.error?.errors ?? body).slice(0, 250)}`);
    }
    await sleep((res.status === 429 ? 5000 : 1000) * 2 ** i);
  }
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Create an unlisted playlist and fill it in order. Returns the playlist id. */
export async function createPlaylist(
  creds: YoutubeCreds,
  opts: { title: string; description: string; videoIds: string[] },
  deps: { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const token = await accessToken(creds, fetchFn);
  const pl = await api(token, 'playlists?part=snippet,status', {
    snippet: { title: opts.title, description: opts.description },
    status: { privacyStatus: 'unlisted' },
  }, fetchFn, sleep);
  for (const videoId of opts.videoIds) {
    await api(token, 'playlistItems?part=snippet', {
      snippet: { playlistId: pl.id, resourceId: { kind: 'youtube#video', videoId } },
    }, fetchFn, sleep);
    await sleep(400); // pacing per spike 003
  }
  return pl.id as string;
}

export interface SearchHit {
  videoId: string;
  title: string;
  channel: string;
}

/**
 * A plain YouTube search, for the review page's "find it myself" box.
 *
 * Unlike the drop's resolver this applies no category filter and no scoring —
 * a human is reading the results, and second-guessing their query would just
 * hide the video they are looking for. One call costs 100 quota units, so it is
 * only ever run when somebody types something.
 */
export async function searchVideos(
  creds: YoutubeCreds, query: string, deps: { fetchFn?: typeof fetch; maxResults?: number } = {},
): Promise<SearchHit[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const token = await accessToken(creds, fetchFn);
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', String(deps.maxResults ?? 8));
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`YouTube search HTTP ${res.status}`);
  const body = await res.json();
  return (body.items ?? [])
    .filter((i: any) => i.id?.videoId)
    .map((i: any) => ({ videoId: i.id.videoId, title: i.snippet?.title ?? '', channel: i.snippet?.channelTitle ?? '' }));
}
