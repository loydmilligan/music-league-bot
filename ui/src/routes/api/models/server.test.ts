import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

const db = openLeagueDb(':memory:');
vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});

let POST: typeof import('./+server.js').POST;
beforeEach(async () => {
  db.prepare('DELETE FROM ai_models').run();
  ({ POST } = await import('./+server.js'));
});

const post = (body: unknown) =>
  ({ request: new Request('http://x/api/models', { method: 'POST', body: JSON.stringify(body) }) }) as unknown as Parameters<typeof POST>[0];

describe('POST /api/models', () => {
  it('persists a $$$ cost_override and kinds', async () => {
    const res = await POST(post({ model_id: 'a/b', cost_override: '$$$', kinds: '["image"]' }));
    const row = await res.json();
    expect(row.cost_override).toBe('$$$');
    expect(row.kinds).toBe('["image"]');
  });
  it('drops an invalid cost_override', async () => {
    const row = await (await POST(post({ model_id: 'a/c', cost_override: 'cheap' }))).json();
    expect(row.cost_override).toBeNull();
  });
  it('filters unknown kinds', async () => {
    const row = await (await POST(post({ model_id: 'a/d', kinds: '["image","bogus"]' }))).json();
    expect(row.kinds).toBe('["image"]');
  });
});
