import { it, expect, vi, beforeEach } from 'vitest';

vi.mock('../httpClient.js', () => ({ botUiFetch: vi.fn() }));

import { botUiFetch } from '../httpClient.js';
import { resolveRound, listLeagues, listRounds, getActiveRounds } from './rounds.js';

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

it('listLeagues GETs /api/leagues', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([{ slug: 'hip-jammers', name: 'Hip Jammers' }]);
  const result = await listLeagues();
  expect(botUiFetch).toHaveBeenCalledWith('/api/leagues');
  expect(result).toEqual([{ slug: 'hip-jammers', name: 'Hip Jammers' }]);
});

it('listRounds GETs /api/rounds/list with leagueSlug only when seasonNumber is omitted', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([]);
  await listRounds({ leagueSlug: 'hip-jammers' });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/list?leagueSlug=hip-jammers');
});

it('listRounds includes seasonNumber when given', async () => {
  vi.mocked(botUiFetch).mockResolvedValue([]);
  await listRounds({ leagueSlug: 'hip-jammers', seasonNumber: 3 });
  expect(botUiFetch).toHaveBeenCalledWith('/api/rounds/list?leagueSlug=hip-jammers&seasonNumber=3');
});

it('getActiveRounds GETs /api/active-rounds', async () => {
  vi.mocked(botUiFetch).mockResolvedValue({ leagues: [] });
  const result = await getActiveRounds();
  expect(botUiFetch).toHaveBeenCalledWith('/api/active-rounds');
  expect(result).toEqual({ leagues: [] });
});
