import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { startRandomMatchup, reshuffleRandomMatchup, selectH2HWinner, getCurrentMatchup } from './h2h.js';

beforeEach(() => { vi.mocked(botUiFetch).mockReset(); });

it('startRandomMatchup POSTs to the start route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ songAId: 1, songBId: 2 });
  const result = await startRandomMatchup({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/5/h2h/random/start', { method: 'POST' });
  expect(result).toEqual({ songAId: 1, songBId: 2 });
});

it('reshuffleRandomMatchup POSTs to the reshuffle route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ songAId: 3, songBId: 4 });
  await reshuffleRandomMatchup({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/5/h2h/random/reshuffle', { method: 'POST' });
});

it('selectH2HWinner POSTs the winnerSongId', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ songAId: 1, songBId: null });
  await selectH2HWinner({ roundId: 5, winnerSongId: 1 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/5/h2h/random/select-winner', {
    method: 'POST', body: JSON.stringify({ winnerSongId: 1 }),
  });
});

it('getCurrentMatchup GETs the current route', async () => {
  vi.mocked(botUiFetch).mockResolvedValue(null);
  const result = await getCurrentMatchup({ roundId: 5 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/5/h2h/random/current');
  expect(result).toBeNull();
});
