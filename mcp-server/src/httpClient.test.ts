import { it, expect, beforeEach, vi, afterEach } from 'vitest';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.BOT_UI_BASE_URL = 'http://localhost:3002';
  process.env.BOT_UI_API_TOKEN = 'test-token';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.resetModules();
});

it('sends the bearer token and base URL on every request', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  global.fetch = fetchMock as any;

  const { botUiFetch } = await import('./httpClient.js');
  const result = await botUiFetch('/api/rounds/resolve?leagueSlug=x&seasonNumber=1&roundNumber=1');

  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3002/api/rounds/resolve?leagueSlug=x&seasonNumber=1&roundNumber=1',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }),
  );
  expect(result).toEqual({ ok: true });
});

it('throws a descriptive error on a non-2xx response', async () => {
  global.fetch = vi.fn().mockResolvedValue(new Response('round not found: 999', { status: 404 })) as any;
  const { botUiFetch } = await import('./httpClient.js');
  await expect(botUiFetch('/api/rounds/resolve')).rejects.toThrow(/404/);
});

it('throws if BOT_UI_BASE_URL is not configured', async () => {
  delete process.env.BOT_UI_BASE_URL;
  const { botUiFetch } = await import('./httpClient.js');
  await expect(botUiFetch('/api/rounds/resolve')).rejects.toThrow(/BOT_UI_BASE_URL/);
});
