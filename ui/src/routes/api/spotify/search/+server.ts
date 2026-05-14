import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';

let _token: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (_token && _token.expiresAt > Date.now()) return _token.value;
  const id = process.env.SPOTIFY_CLIENT_ID!;
  const secret = process.env.SPOTIFY_CLIENT_SECRET!;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json() as any;
  _token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return _token.value;
}

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q');
  if (!q) throw error(400, 'q required');
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json() as any;
  const tracks = (data.tracks?.items ?? []).map((t: any) => ({
    uri: t.uri, name: t.name,
    artists: t.artists.map((a: any) => a.name).join(', '),
    album: t.album.name, year: t.album.release_date?.slice(0,4) ?? '',
    imageUrl: t.album.images?.[2]?.url ?? null,
  }));
  return json(tracks);
};
