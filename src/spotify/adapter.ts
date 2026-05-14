import type { ResolvedTrack, ISpotifyAdapter } from '../music/types.js';
import { spotifyFetch, SpotifyApiError } from './token.js';

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string };
  duration_ms: number;
  external_urls: { spotify: string };
}

function mapTrack(track: SpotifyTrack, confidence: number): ResolvedTrack {
  return {
    title: track.name,
    artist: track.artists[0].name,
    album: track.album.name,
    durationMs: track.duration_ms,
    spotifyTrackId: track.id,
    spotifyUri: track.uri,
    sourceUrl: track.external_urls.spotify,
    confidence,
  };
}

export class SpotifyAdapter implements ISpotifyAdapter {
  private userId: string | null = null;

  async searchTrack(query: string): Promise<ResolvedTrack | null> {
    const response = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=1`);
    const data = (await response.json()) as { tracks: { items: SpotifyTrack[] } };
    if (data.tracks.items.length === 0) return null;
    return mapTrack(data.tracks.items[0], 0.8);
  }

  async searchTracks(query: string, limit = 10): Promise<ResolvedTrack[]> {
    const response = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`);
    const data = (await response.json()) as { tracks: { items: SpotifyTrack[] } };
    return data.tracks.items.map(t => mapTrack(t, 0.8));
  }

  async getTrackById(spotifyTrackId: string): Promise<ResolvedTrack | null> {
    try {
      const response = await spotifyFetch(`/tracks/${spotifyTrackId}`);
      return mapTrack((await response.json()) as SpotifyTrack, 1.0);
    } catch (err) {
      if (err instanceof Error && err.name === 'SpotifyApiError' && (err as SpotifyApiError).status === 404) {
        return null;
      }
      throw err;
    }
  }

  async findOrCreatePlaylist(name: string): Promise<string> {
    let url: string | null = '/me/playlists?limit=50';
    while (url) {
      const response = await spotifyFetch(url);
      const data = (await response.json()) as {
        items: Array<{ id: string; name: string }>;
        next: string | null;
      };
      const found = data.items.find((p) => p.name === name);
      if (found) return found.id;
      url = data.next;
    }

    const userId = await this.getUserId();
    const response = await spotifyFetch(`/users/${userId}/playlists`, {
      method: 'POST',
      body: JSON.stringify({ name, public: false }),
    });
    return ((await response.json()) as { id: string }).id;
  }

  async addTrackToPlaylist(playlistId: string, spotifyUri: string): Promise<void> {
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: [spotifyUri] }),
    });
  }

  async isTrackInPlaylist(playlistId: string, spotifyUri: string): Promise<boolean> {
    let url: string | null =
      `/playlists/${playlistId}/tracks?fields=items(track(uri)),next&limit=100`;
    while (url) {
      const response = await spotifyFetch(url);
      const data = (await response.json()) as {
        items: Array<{ track: { uri: string } | null }>;
        next: string | null;
      };
      if (data.items.some((item) => item.track?.uri === spotifyUri)) return true;
      url = data.next;
    }
    return false;
  }

  async createPlaylist(name: string): Promise<{ id: string; url: string }> {
    const userId = await this.getUserId();
    const response = await spotifyFetch(`/users/${userId}/playlists`, {
      method: 'POST',
      body: JSON.stringify({ name, public: false }),
    });
    const data = (await response.json()) as { id: string; external_urls: { spotify: string } };
    return { id: data.id, url: data.external_urls.spotify };
  }

  async addTracksToPlaylist(playlistId: string, uris: string[]): Promise<void> {
    for (let i = 0; i < uris.length; i += 100) {
      await spotifyFetch(`/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
      });
    }
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await spotifyFetch(`/playlists/${playlistId}/followers`, { method: 'DELETE' });
  }

  private async getUserId(): Promise<string> {
    if (this.userId) return this.userId;
    const response = await spotifyFetch('/me');
    this.userId = ((await response.json()) as { id: string }).id;
    return this.userId;
  }
}
