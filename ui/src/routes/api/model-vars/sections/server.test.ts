import { it, expect, vi, beforeEach, describe } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import { KNOWN_SECTIONS } from '$lib/digest/sectionState.js';
import { HARDCODED_MODEL } from '$lib/digest/modelFor.js';

const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
  const actual = await orig<typeof import('$lib/db/client.js')>();
  return { ...actual, getDb: () => db };
});

let GET: typeof import('./+server.js').GET;

beforeEach(async () => {
  // Clear any section pins between tests
  for (const section of KNOWN_SECTIONS) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(`digest_model_${section}`);
  }
  ({ GET } = await import('./+server.js'));
});

describe('GET /api/model-vars/sections', () => {
  it('returns an object with exactly 16 section keys', async () => {
    const res = await GET({} as Parameters<typeof GET>[0]);
    const body = await res.json() as Record<string, unknown>;
    expect(Object.keys(body)).toHaveLength(16);
  });

  it('includes all known section keys', async () => {
    const res = await GET({} as Parameters<typeof GET>[0]);
    const body = await res.json() as Record<string, unknown>;
    for (const section of KNOWN_SECTIONS) {
      expect(body).toHaveProperty(section);
    }
  });

  it('each entry has the required SectionState fields', async () => {
    const res = await GET({} as Parameters<typeof GET>[0]);
    const body = await res.json() as Record<string, { key: string; section: string; label: string; bucket: string; selected: unknown; resolved: string; requires: unknown }>;

    for (const [section, state] of Object.entries(body)) {
      expect(state.key).toBe(`digest_model_${section}`);
      expect(state.section).toBe(section);
      expect(typeof state.label).toBe('string');
      expect(['predict', 'digest']).toContain(state.bucket);
      expect(state.selected).toBeNull(); // no pins set
      expect(typeof state.resolved).toBe('string');
      expect(state.requires).toEqual({ json: true });
    }
  });

  it('resolved falls back to HARDCODED_MODEL when no pin and no env', async () => {
    const origPredict = process.env.OPENROUTER_PREDICT_MODEL;
    const origDigest = process.env.OPENROUTER_DIGEST_MODEL;
    delete process.env.OPENROUTER_PREDICT_MODEL;
    delete process.env.OPENROUTER_DIGEST_MODEL;

    const res = await GET({} as Parameters<typeof GET>[0]);
    const body = await res.json() as Record<string, { resolved: string }>;

    for (const section of KNOWN_SECTIONS) {
      expect(body[section].resolved).toBe(HARDCODED_MODEL);
    }

    if (origPredict === undefined) delete process.env.OPENROUTER_PREDICT_MODEL;
    else process.env.OPENROUTER_PREDICT_MODEL = origPredict;
    if (origDigest === undefined) delete process.env.OPENROUTER_DIGEST_MODEL;
    else process.env.OPENROUTER_DIGEST_MODEL = origDigest;
  });

  it('season-update section maps to digest bucket', async () => {
    const res = await GET({} as Parameters<typeof GET>[0]);
    const body = await res.json() as Record<string, { bucket: string }>;
    expect(body['season-update'].bucket).toBe('digest');
  });
});
