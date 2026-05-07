import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ISpotifyAdapter } from '../src/music/types.js';
import { resolveTrack } from '../src/resolver/resolveTrack.js';
import type { ParsedSubmission } from '../src/parser/types.js';

function makeSubmission(overrides: Partial<ParsedSubmission> = {}): ParsedSubmission {
  return {
    command: 'song',
    rawText: '',
    sourceUrl: null,
    artistHint: null,
    titleHint: null,
    tags: [],
    ...overrides,
  };
}

const resolvedTrack = {
  title: 'No Ordinary Love',
  artist: 'Sade',
  album: 'Love Deluxe',
  durationMs: 290000,
  spotifyTrackId: 'track1',
  spotifyUri: 'spotify:track:track1',
  sourceUrl: 'https://open.spotify.com/track/track1',
  confidence: 1.0,
};

function makeMockAdapter(overrides: Partial<ISpotifyAdapter> = {}): ISpotifyAdapter {
  return {
    searchTrack: vi.fn().mockResolvedValue(null),
    getTrackById: vi.fn().mockResolvedValue(null),
    findOrCreatePlaylist: vi.fn(),
    addTrackToPlaylist: vi.fn(),
    isTrackInPlaylist: vi.fn(),
    ...overrides,
  };
}

describe('resolveTrack — Spotify HTTPS URL', () => {
  it('extracts track ID and returns found status', async () => {
    const adapter = makeMockAdapter({
      getTrackById: vi.fn().mockResolvedValue(resolvedTrack),
    });
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7?si=abc' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('found');
    expect(result.track).toBe(resolvedTrack);
    expect(result.query).toBe('https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7?si=abc');
    expect(adapter.getTrackById).toHaveBeenCalledWith('4LRPiXqCikLlN15c3yImP7');
  });

  it('returns not-found when adapter returns null for a Spotify URL', async () => {
    const adapter = makeMockAdapter({ getTrackById: vi.fn().mockResolvedValue(null) });
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
  });
});

describe('resolveTrack — Spotify URI', () => {
  it('extracts track ID from spotify:track: URI and returns found', async () => {
    const adapter = makeMockAdapter({
      getTrackById: vi.fn().mockResolvedValue(resolvedTrack),
    });
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'spotify:track:4LRPiXqCikLlN15c3yImP7' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('found');
    expect(adapter.getTrackById).toHaveBeenCalledWith('4LRPiXqCikLlN15c3yImP7');
  });
});

describe('resolveTrack — YouTube URL', () => {
  it('returns not-found with youtube stub message for youtube.com URLs', async () => {
    const adapter = makeMockAdapter();
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
    expect(result.query).toContain('YouTube');
    expect(adapter.getTrackById).not.toHaveBeenCalled();
    expect(adapter.searchTrack).not.toHaveBeenCalled();
  });

  it('returns not-found for youtu.be short URLs', async () => {
    const adapter = makeMockAdapter();
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.query).toContain('YouTube');
  });
});

describe('resolveTrack — other URL', () => {
  it('returns not-found for an unrecognised URL', async () => {
    const adapter = makeMockAdapter();
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://soundcloud.com/artist/track' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
    expect(adapter.searchTrack).not.toHaveBeenCalled();
  });
});

describe('resolveTrack — text search', () => {
  it('returns found when confidence >= threshold', async () => {
    const highConfidenceTrack = { ...resolvedTrack, confidence: 0.9 };
    const adapter = makeMockAdapter({
      searchTrack: vi.fn().mockResolvedValue(highConfidenceTrack),
    });
    const result = await resolveTrack(
      makeSubmission({ artistHint: 'Sade', titleHint: 'No Ordinary Love' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('found');
    expect(result.track).toBe(highConfidenceTrack);
    expect(result.query).toBe('Sade - No Ordinary Love');
    expect(adapter.searchTrack).toHaveBeenCalledWith('Sade - No Ordinary Love');
  });

  it('returns low-confidence when confidence < threshold', async () => {
    const lowConfidenceTrack = { ...resolvedTrack, confidence: 0.8 };
    const adapter = makeMockAdapter({
      searchTrack: vi.fn().mockResolvedValue(lowConfidenceTrack),
    });
    const result = await resolveTrack(
      makeSubmission({ artistHint: 'Sade', titleHint: 'No Ordinary Love' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('low-confidence');
    expect(result.track).toBe(lowConfidenceTrack);
  });

  it('returns not-found when searchTrack returns null', async () => {
    const adapter = makeMockAdapter({ searchTrack: vi.fn().mockResolvedValue(null) });
    const result = await resolveTrack(
      makeSubmission({ artistHint: 'Unknown', titleHint: 'Song' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
  });
});

describe('resolveTrack — no input', () => {
  it('returns not-found when no URL and no artist/title hints', async () => {
    const adapter = makeMockAdapter();
    const result = await resolveTrack(makeSubmission(), adapter, 0.9);
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
    expect(result.query).toBe('');
    expect(adapter.searchTrack).not.toHaveBeenCalled();
    expect(adapter.getTrackById).not.toHaveBeenCalled();
  });
});

describe('resolveTrack — error propagation', () => {
  it('propagates errors thrown by the adapter', async () => {
    const adapter = makeMockAdapter({
      getTrackById: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    await expect(
      resolveTrack(
        makeSubmission({ sourceUrl: 'https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7' }),
        adapter,
        0.9,
      ),
    ).rejects.toThrow('Network error');
  });
});
