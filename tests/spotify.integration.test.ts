import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SpotifyAdapter } from '../src/spotify/adapter.js';
import { spotifyFetch } from '../src/spotify/token.js';

const skipIntegration = !process.env.SPOTIFY_REFRESH_TOKEN;

describe.skipIf(skipIntegration)('Spotify integration (real API)', () => {
  const adapter = new SpotifyAdapter();
  let testPlaylistId = '';
  let testTrackId = '';
  let testTrackUri = '';

  beforeAll(async () => {
    const track = await adapter.searchTrack('Sade No Ordinary Love');
    if (!track?.spotifyTrackId || !track.spotifyUri) {
      throw new Error('Setup: could not find Sade track on Spotify');
    }
    testTrackId = track.spotifyTrackId;
    testTrackUri = track.spotifyUri;
    testPlaylistId = await adapter.findOrCreatePlaylist('mlbot-integration-test');
  });

  afterAll(async () => {
    if (testPlaylistId) {
      await spotifyFetch(`/playlists/${testPlaylistId}/followers`, { method: 'DELETE' });
    }
  });

  it('searchTrack returns Sade for "Sade No Ordinary Love"', async () => {
    const track = await adapter.searchTrack('Sade No Ordinary Love');
    expect(track).not.toBeNull();
    expect(track!.artist).toBe('Sade');
    expect(track!.confidence).toBe(0.8);
    expect(track!.spotifyUri).toMatch(/^spotify:track:/);
  });

  it('getTrackById returns the same track with confidence 1.0', async () => {
    const track = await adapter.getTrackById(testTrackId);
    expect(track).not.toBeNull();
    expect(track!.confidence).toBe(1.0);
    expect(track!.spotifyTrackId).toBe(testTrackId);
  });

  it('getTrackById returns null for a nonexistent ID', async () => {
    const track = await adapter.getTrackById('0000000000000000000000');
    expect(track).toBeNull();
  });

  it('findOrCreatePlaylist returns same ID on second call', async () => {
    const id = await adapter.findOrCreatePlaylist('mlbot-integration-test');
    expect(id).toBe(testPlaylistId);
  });

  it('addTrackToPlaylist adds the track without error', async () => {
    await expect(
      adapter.addTrackToPlaylist(testPlaylistId, testTrackUri),
    ).resolves.toBeUndefined();
  });

  it('isTrackInPlaylist returns true for the added track', async () => {
    const found = await adapter.isTrackInPlaylist(testPlaylistId, testTrackUri);
    expect(found).toBe(true);
  });

  it('isTrackInPlaylist returns false for a URI not in the playlist', async () => {
    const found = await adapter.isTrackInPlaylist(
      testPlaylistId,
      'spotify:track:00000000000000000000000000',
    );
    expect(found).toBe(false);
  });
});
