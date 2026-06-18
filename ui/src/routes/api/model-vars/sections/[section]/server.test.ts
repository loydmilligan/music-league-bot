import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { KNOWN_SECTIONS } from '$lib/digest/sectionState.js';
import { HARDCODED_MODEL } from '$lib/digest/modelFor.js';

const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});

let PUT: typeof import('./+server.js').PUT;

function mkPutEvt(section: string, body: unknown) {
  return {
    params: { section },
    request: { json: () => Promise.resolve(body), } ,
  } as unknown as Parameters<typeof PUT>[0];
}

beforeEach(async () => {
  for (const section of KNOWN_SECTIONS) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(`digest_model_${section}`);
  }
  ({ PUT } = await import('./+server.js'));
});

describe('PUT /api/model-vars/sections/:section', () => {
  it('sets a pin and returns SectionState with selected + resolved', async () => {
    const res = await PUT(mkPutEvt('podium', { model_id: 'openai/gpt-4o-mini' }));
    const body = await res.json() as { section: string; selected: string; resolved: string };
    expect(body.section).toBe('podium');
    expect(body.selected).toBe('openai/gpt-4o-mini');
    expect(body.resolved).toBe('openai/gpt-4o-mini');
  });

  it('persists pin to settings table under digest_model_<section> key', async () => {
    await PUT(mkPutEvt('villain', { model_id: 'meta-llama/llama-3.1-405b' }));
    const row = db.prepare("SELECT value FROM settings WHERE key = 'digest_model_villain'").get() as { value: string } | undefined;
    expect(row?.value).toBe('meta-llama/llama-3.1-405b');
  });

  it('null model_id clears the pin — selected becomes null, resolved falls back', async () => {
    // First set a pin
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('digest_model_flow', 'openai/gpt-4o-mini')").run();

    const origDigest = process.env.OPENROUTER_DIGEST_MODEL;
    delete process.env.OPENROUTER_DIGEST_MODEL;

    const res = await PUT(mkPutEvt('flow', { model_id: null }));
    const body = await res.json() as { selected: string | null; resolved: string };
    expect(body.selected).toBeNull();
    expect(body.resolved).toBe(HARDCODED_MODEL);

    if (origDigest === undefined) delete process.env.OPENROUTER_DIGEST_MODEL;
    else process.env.OPENROUTER_DIGEST_MODEL = origDigest;
  });

  it('returns 400 for an unknown section key', async () => {
    await expect(PUT(mkPutEvt('totally-unknown', { model_id: 'openai/gpt-4o' }))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when body.model_id is missing', async () => {
    await expect(PUT(mkPutEvt('podium', { wrong_field: 'x' }))).rejects.toMatchObject({ status: 400 });
  });

  it('returns 400 when body.model_id is not string or null', async () => {
    await expect(PUT(mkPutEvt('podium', { model_id: 42 }))).rejects.toMatchObject({ status: 400 });
  });

  it('pin for one section does not affect a different section', async () => {
    await PUT(mkPutEvt('podium', { model_id: 'openai/gpt-4o-mini' }));
    const row = db.prepare("SELECT value FROM settings WHERE key = 'digest_model_villain'").get();
    expect(row).toBeUndefined();
  });

  it('returns full SectionState shape including bucket and requires', async () => {
    const res = await PUT(mkPutEvt('taste-fingerprint', { model_id: 'openai/gpt-4o-mini' }));
    const body = await res.json() as { key: string; bucket: string; requires: unknown; label: string };
    expect(body.key).toBe('digest_model_taste-fingerprint');
    expect(body.bucket).toBe('predict');
    expect(body.requires).toEqual({ json: true });
    expect(typeof body.label).toBe('string');
  });
});
