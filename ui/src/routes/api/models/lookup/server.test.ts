import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { parseKinds } from '$lib/models/kinds.js';

const payload = {
  data: [{
    id: 'google/gemini-2.5-flash-image',
    name: 'x',
    pricing: { prompt: '0.0000003', completion: '0.0000025' },
    architecture: { modality: 'text+image->text+image', input_modalities: ['text', 'image'], output_modalities: ['text', 'image'] },
  }],
};

let GET: typeof import('./+server.js').GET;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })));
  ({ GET } = await import('./+server.js'));
});
afterEach(() => { vi.unstubAllGlobals(); });

const evt = (id: string) =>
  ({ url: new URL('http://x/api/models/lookup?id=' + encodeURIComponent(id)) }) as unknown as Parameters<typeof GET>[0];

describe('GET /api/models/lookup', () => {
  it('accepts an openrouter URL and derives kinds', async () => {
    const res = await GET(evt('https://openrouter.ai/google/gemini-2.5-flash-image'));
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.draft.model_id).toBe('google/gemini-2.5-flash-image');
    expect(parseKinds(body.draft.kinds)).toContain('image');
    expect(body.draft.cap_vision).toBe(1);
  });
  it('unknown id gives an estimated draft with empty kinds', async () => {
    const body = await (await GET(evt('acme/unknown'))).json();
    expect(body.found).toBe(false);
    expect(body.draft.kinds).toBe('[]');
  });
  it('garbage input is a 400', async () => {
    await expect(GET(evt('garbage text'))).rejects.toMatchObject({ status: 400 });
  });
});
