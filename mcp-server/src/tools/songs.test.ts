import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { addSongToRound, addSongToShortlist, updateSong, removeSongFromRound, listRoundSongs } from './songs.js';

beforeEach(() => { vi.mocked(botUiFetch).mockReset(); });

it('addSongToRound POSTs to the cascade route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ shortlistSongId: 'uuid-1', researchSongId: 7 });

  const result = await addSongToRound({
    roundId: 1, spotifyUri: 'spotify:track:a', title: 'Song', artist: 'Artist',
    notes: 'good pick', ratings: { discovery: 4, themeFit: 5, quality: 3, replayability: 4 },
  });

  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/1/research-songs', {
    method: 'POST',
    body: JSON.stringify({
      spotifyUri: 'spotify:track:a', title: 'Song', artist: 'Artist', album: undefined,
      notes: 'good pick',
      ratings: { discoveryPotential: 4, themeFit: 5, quality: 3, replayability: 4 },
    }),
  });
  expect(result.researchSongId).toBe(7);
});

it('addSongToShortlist POSTs to the existing shortlist route with snake_case body', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 'uuid-2' });

  await addSongToShortlist({ spotifyUri: 'spotify:track:b', title: 'Song B', artist: 'Artist B', album: 'Album B' });

  expect(botUiFetch).toHaveBeenCalledWith('/api/shortlist', {
    method: 'POST',
    body: JSON.stringify({ spotify_uri: 'spotify:track:b', title: 'Song B', artist: 'Artist B', album: 'Album B' }),
  });
});

it('updateSong PATCHes the research route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 7, notes: 'updated' });

  await updateSong({ researchSongId: 7, roundId: 1, notes: 'updated', ratings: { quality: 5 } });

  expect(botUiFetch).toHaveBeenCalledWith('/api/research/1', {
    method: 'PATCH',
    body: JSON.stringify({ id: 7, notes: 'updated', quality: 5 }),
  });
});

it('removeSongFromRound PATCHes with removedReason=user_removed', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 7 });

  await removeSongFromRound({ researchSongId: 7, roundId: 1 });

  expect(botUiFetch).toHaveBeenCalledWith(
    '/api/research/1',
    expect.objectContaining({
      method: 'PATCH',
      body: expect.any(String),
    })
  );

  const callArgs = vi.mocked(botUiFetch).mock.calls[0];
  const body = JSON.parse(callArgs[1]!.body as string);
  expect(body).toEqual({
    id: 7,
    removedReason: 'user_removed',
    removedAt: expect.any(String),
  });
});

it('listRoundSongs GETs the research route with includeRemoved passed through', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([]);

  await listRoundSongs({ roundId: 1, includeRemoved: true });

  expect(botUiFetch).toHaveBeenCalledWith('/api/research/1?includeRemoved=true');
});

it('listRoundSongs defaults includeRemoved to false (omitted from the query string)', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([]);

  await listRoundSongs({ roundId: 1 });

  expect(botUiFetch).toHaveBeenCalledWith('/api/research/1');
});
