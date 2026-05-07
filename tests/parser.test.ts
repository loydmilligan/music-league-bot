import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/parser/parseMessage.js';

describe('parseMessage', () => {
  it('returns null for messages not starting with !song', () => {
    expect(parseMessage('hello world')).toBeNull();
    expect(parseMessage('https://open.spotify.com/track/xxx')).toBeNull();
    expect(parseMessage('')).toBeNull();
  });

  it('returns null for unknown commands', () => {
    expect(parseMessage('!help')).toBeNull();
    expect(parseMessage('!playlist something')).toBeNull();
  });

  it('parses a Spotify URL', () => {
    const result = parseMessage('!song https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh');
    expect(result).toEqual({
      command: 'song',
      rawText: '!song https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
      sourceUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
      artistHint: null,
      titleHint: null,
      tags: [],
    });
  });

  it('parses a Spotify URL with query params', () => {
    const result = parseMessage('!song https://open.spotify.com/track/xxx?si=abc123');
    expect(result?.sourceUrl).toBe('https://open.spotify.com/track/xxx?si=abc123');
    expect(result?.tags).toEqual([]);
  });

  it('parses a YouTube URL', () => {
    const result = parseMessage('!song https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result?.sourceUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('parses a Spotify URL followed by a tag', () => {
    const result = parseMessage('!song https://open.spotify.com/track/xxx #summer');
    expect(result?.sourceUrl).toBe('https://open.spotify.com/track/xxx');
    expect(result?.tags).toEqual(['summer']);
  });

  it('parses plain text artist - title', () => {
    const result = parseMessage('!song Sade - No Ordinary Love');
    expect(result).toEqual({
      command: 'song',
      rawText: '!song Sade - No Ordinary Love',
      sourceUrl: null,
      artistHint: 'Sade',
      titleHint: 'No Ordinary Love',
      tags: [],
    });
  });

  it('parses artist - title with a single tag', () => {
    const result = parseMessage('!song The Beths - Expert in a Dying Field #week7');
    expect(result?.artistHint).toBe('The Beths');
    expect(result?.titleHint).toBe('Expert in a Dying Field');
    expect(result?.tags).toEqual(['week7']);
  });

  it('parses artist - title with multiple tags', () => {
    const result = parseMessage('!song Artist - Title #summer #finals');
    expect(result?.artistHint).toBe('Artist');
    expect(result?.titleHint).toBe('Title');
    expect(result?.tags).toEqual(['summer', 'finals']);
  });

  it('is case-insensitive for the command', () => {
    const result = parseMessage('!Song https://open.spotify.com/track/xxx');
    expect(result?.command).toBe('song');
  });

  it('handles leading/trailing whitespace on the full message', () => {
    const result = parseMessage('  !song Sade - No Ordinary Love  ');
    expect(result?.artistHint).toBe('Sade');
    expect(result?.titleHint).toBe('No Ordinary Love');
  });
});
