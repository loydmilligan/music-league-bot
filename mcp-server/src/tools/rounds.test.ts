import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { resolveRound } from './rounds.js';

beforeEach(() => { vi.mocked(botUiFetch).mockReset(); });

it('resolveRound calls the resolve endpoint with the given params', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 42, name: 'Round X', roundNumber: 5, phase: 'complete', seasonNumber: 3, leagueSlug: 'hip-jammers' });

  const result = await resolveRound({ leagueSlug: 'hip-jammers', seasonNumber: 3, roundNumber: 5 });

  expect(botUiFetch).toHaveBeenCalledWith(
    '/api/rounds/resolve?leagueSlug=hip-jammers&seasonNumber=3&roundNumber=5',
  );
  expect(result.id).toBe(42);
});

it('resolveRound supports roundName instead of roundNumber', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ id: 42, name: 'Round X', roundNumber: 5, phase: 'complete', seasonNumber: 3, leagueSlug: 'hip-jammers' });

  await resolveRound({ leagueSlug: 'hip-jammers', seasonNumber: 3, roundName: 'Round X' });

  expect(botUiFetch).toHaveBeenCalledWith(
    '/api/rounds/resolve?leagueSlug=hip-jammers&seasonNumber=3&roundName=Round+X',
  );
});
