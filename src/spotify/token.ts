export class SpotifyApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

type TokenCache = { accessToken: string; expiresAt: number } | null;
let tokenCache: TokenCache = null;

export function _resetTokenCache(cache: TokenCache = null): void {
  tokenCache = cache;
}

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Spotify credentials. Ensure SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN are set in .env. Run `npm run spotify-auth` to get a refresh token.',
    );
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });

  if (!response.ok) {
    throw new SpotifyApiError(response.status, `Token refresh failed: ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.accessToken;
}

export async function spotifyFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const url = path.startsWith('https://') ? path : `https://api.spotify.com/v1${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
    Authorization: `Bearer ${token}`,
  };

  const attempt = () => fetch(url, { ...options, headers });
  const response = await attempt();

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '1', 10);
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    const retried = await attempt();
    if (!retried.ok) {
      const body = (await retried.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new SpotifyApiError(retried.status, body.error?.message ?? retried.statusText);
    }
    return retried;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new SpotifyApiError(response.status, body.error?.message ?? response.statusText);
  }

  return response;
}
