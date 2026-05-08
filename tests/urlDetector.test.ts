import { describe, it, expect } from 'vitest';
import { detectMusicUrls } from '../src/bot/urlDetector.js';

describe('detectMusicUrls', () => {
  it('returns empty array for plain text with no URLs', () => {
    expect(detectMusicUrls('just some plain text here')).toEqual([]);
  });

  it('detects a Spotify track URL', () => {
    const body = 'Check this out https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';
    const results = detectMusicUrls(body);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
      platform: 'spotify',
    });
  });

  it('detects a YouTube watch URL', () => {
    const body = 'Listen https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const results = detectMusicUrls(body);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
    });
  });

  it('detects a youtu.be short URL', () => {
    const body = 'Short link https://youtu.be/dQw4w9WgXcQ';
    const results = detectMusicUrls(body);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      platform: 'youtube',
    });
  });

  it('detects a YouTube Music URL', () => {
    const body = 'YT Music https://music.youtube.com/watch?v=dQw4w9WgXcQ';
    const results = detectMusicUrls(body);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: 'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      platform: 'youtube',
    });
  });

  it('detects an Apple Music URL', () => {
    const body = 'Apple music https://music.apple.com/us/album/some-album/123456789';
    const results = detectMusicUrls(body);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      url: 'https://music.apple.com/us/album/some-album/123456789',
      platform: 'apple-music',
    });
  });

  it('detects multiple URLs in one message (Spotify + YouTube)', () => {
    const body = 'Two songs: https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC and https://youtu.be/dQw4w9WgXcQ';
    const results = detectMusicUrls(body);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.platform)).toContain('spotify');
    expect(results.map((r) => r.platform)).toContain('youtube');
  });

  it('deduplicates the same URL appearing twice in one message', () => {
    const url = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC';
    const body = `${url} and again ${url}`;
    const results = detectMusicUrls(body);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe(url);
  });

  it('ignores non-music URLs', () => {
    const body = 'Check https://google.com and https://example.com';
    expect(detectMusicUrls(body)).toEqual([]);
  });

  it('handles Spotify URL with query params', () => {
    const body = 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123xyz';
    const results = detectMusicUrls(body);
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123xyz');
    expect(results[0].platform).toBe('spotify');
  });
});
