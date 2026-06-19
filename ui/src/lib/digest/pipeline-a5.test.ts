/**
 * sprint-43 a5: Per-section pins honored on initial draft.
 *
 * This is the acceptance test that closes the production gap:
 * when a section has a per-section model pin (digest_model_<section>),
 * generateDraft must use that model for the EP containing that section.
 *
 * Uses the DEFAULT_PIPELINE (one skip after chat):
 *   EP0: quotes, consensus, podium (no chat in mkData)  → base model
 *   EP1: villain, flow                                   → villain pinned to premium
 *
 * Verified via the HTTP body sent to OpenRouter per EP call.
 */

import { it, expect, describe, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { generateDraft, type RoundData, type RoundBundleEntry } from './llm.js';
import { DEFAULT_PIPELINE, type Pipeline } from './pipeline.js';

function mkBundleEntry(round_number: number, name: string): RoundBundleEntry {
  return { round_number, name, top3: [], bottom1: null, winner: null, isCurrent: false, isPrev: false };
}

function mkData(): RoundData {
  return {
    round: { id: 99, name: 'Pin Test Round', description: null },
    league: { id: 1, name: 'Test League' },
    roundSequence: { number: 1, total: 1 },
    priorRounds: [],
    bundle: [mkBundleEntry(1, 'Pin Test Round')],
    submissions: [],
    votes: [],
    chatMentions: [],
    relContext: '',
  };
}

// Build a DB mock that returns the DEFAULT_PIPELINE and section pins.
function makeDb(sectionPins: Record<string, string> = {}, baseModel = 'base-model'): Database.Database {
  return {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn((key: string) => {
        const lsql = sql.toLowerCase();
        if (lsql.includes('settings')) {
          if (key === 'pipeline_config') return { value: JSON.stringify(DEFAULT_PIPELINE) };
          // Per-section pin: digest_model_<section>
          const pinned = sectionPins[key];
          if (pinned) return { value: pinned };
          // Bucket defaults.
          if (key === 'digest_model') return { value: baseModel };
          if (key === 'predict_model') return { value: baseModel };
          return undefined;
        }
        if (lsql.includes('league_id')) return { league_id: 1 };
        return undefined;
      }),
      all: vi.fn(() => []),
      run: vi.fn(),
    })),
    exec: vi.fn(),
  } as unknown as Database.Database;
}

// Build a fake fetch response returning the given sections.
function makeFetchResponse(sectionKinds: string[]): Response {
  const sections: Record<string, unknown> = {};
  for (const k of sectionKinds) {
    sections[k] = { title: k, body: `body-${k}`, items: [] };
  }
  const responseBody = JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ sections }) }, finish_reason: 'stop' }],
    usage: { cost: 0.01, prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
  return {
    ok: true,
    json: async () => JSON.parse(responseBody),
    text: async () => responseBody,
  } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
let fetchResponses: Response[] = [];

beforeEach(() => {
  vi.restoreAllMocks();
  fetchResponses = [];
  process.env.OPENROUTER_API_KEY = 'test-key';
  fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
    const response = fetchResponses.shift();
    if (!response) throw new Error('No more fetch responses queued');
    return response;
  });
});

describe('generateDraft — per-section pins honored on initial draft (a5)', () => {
  it('villain pinned to premium-model: EP1 call uses premium-model for villain', async () => {
    // Arrange: villain pinned to premium; all others use base-model.
    const db = makeDb({ digest_model_villain: 'premium-model' }, 'base-model');

    // EP0: quotes, consensus, podium (no chat since no chatMentions)
    fetchResponses.push(makeFetchResponse(['quotes', 'consensus', 'podium']));
    // EP1: villain (premium) and flow (base) — in DEFAULT_PIPELINE with one skip
    // villain is pinned to premium-model, flow uses base-model → 2 groups in EP1
    fetchResponses.push(makeFetchResponse(['villain']));
    fetchResponses.push(makeFetchResponse(['flow']));

    const result = await generateDraft(mkData(), undefined, undefined, db);

    // Expect 3 fetch calls: EP0 (1 group), EP1 (2 groups: villain + flow split by model).
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // EP0 call (fetch[0]): model should be 'base-model'.
    const ep0Body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(ep0Body.model).toBe('base-model');
    // EP0 sections: quotes, consensus, podium.
    const ep0UserMsg = ep0Body.messages.find((m: { role: string }) => m.role === 'user');
    expect(ep0UserMsg?.content).toMatch(/quotes/);
    expect(ep0UserMsg?.content).toMatch(/consensus/);
    expect(ep0UserMsg?.content).toMatch(/podium/);

    // EP1 call for villain (fetch[1]): model must be 'premium-model'.
    const ep1VillainBody = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
    expect(ep1VillainBody.model).toBe('premium-model');
    const ep1VillainUserMsg = ep1VillainBody.messages.find((m: { role: string }) => m.role === 'user');
    expect(ep1VillainUserMsg?.content).toMatch(/villain/);

    // EP1 call for flow (fetch[2]): model must be 'base-model'.
    const ep1FlowBody = JSON.parse(fetchSpy.mock.calls[2][1]!.body as string);
    expect(ep1FlowBody.model).toBe('base-model');
    const ep1FlowUserMsg = ep1FlowBody.messages.find((m: { role: string }) => m.role === 'user');
    expect(ep1FlowUserMsg?.content).toMatch(/flow/);

    // All sections present in result.
    expect(result.sections['villain']).toBeDefined();
    expect(result.sections['flow']).toBeDefined();
    expect(result.sections['podium']).toBeDefined();
  });

  it('no pins: all sections use base-model → DEFAULT_PIPELINE produces 2 fetch calls (one per EP)', async () => {
    const db = makeDb({}, 'base-model');

    // EP0: quotes, consensus, podium
    fetchResponses.push(makeFetchResponse(['quotes', 'consensus', 'podium']));
    // EP1: villain, flow — same model → merged into 1 group
    fetchResponses.push(makeFetchResponse(['villain', 'flow']));

    await generateDraft(mkData(), undefined, undefined, db);

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const ep0Body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(ep0Body.model).toBe('base-model');

    const ep1Body = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
    expect(ep1Body.model).toBe('base-model');
  });

  it('villain AND flow both pinned to same premium-model → EP1 still 1 group (merged)', async () => {
    const db = makeDb({
      digest_model_villain: 'premium-model',
      digest_model_flow: 'premium-model',
    }, 'base-model');

    // EP0: quotes, consensus, podium (base)
    fetchResponses.push(makeFetchResponse(['quotes', 'consensus', 'podium']));
    // EP1: villain + flow merged into 1 group (same premium model)
    fetchResponses.push(makeFetchResponse(['villain', 'flow']));

    await generateDraft(mkData(), undefined, undefined, db);

    // Only 2 fetch calls: EP0 + EP1 merged.
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const ep1Body = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
    expect(ep1Body.model).toBe('premium-model');
    const ep1UserMsg = ep1Body.messages.find((m: { role: string }) => m.role === 'user');
    expect(ep1UserMsg?.content).toMatch(/villain/);
    expect(ep1UserMsg?.content).toMatch(/flow/);
  });

  it('villain pinned to different model than flow → EP1 splits into 2 groups (2 calls)', async () => {
    const db = makeDb({
      digest_model_villain: 'premium-villain-model',
      digest_model_flow: 'premium-flow-model',
    }, 'base-model');

    // EP0
    fetchResponses.push(makeFetchResponse(['quotes', 'consensus', 'podium']));
    // EP1 villain
    fetchResponses.push(makeFetchResponse(['villain']));
    // EP1 flow
    fetchResponses.push(makeFetchResponse(['flow']));

    await generateDraft(mkData(), undefined, undefined, db);

    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const ep1VillainBody = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
    expect(ep1VillainBody.model).toBe('premium-villain-model');

    const ep1FlowBody = JSON.parse(fetchSpy.mock.calls[2][1]!.body as string);
    expect(ep1FlowBody.model).toBe('premium-flow-model');
  });
});
