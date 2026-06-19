/**
 * sprint-43 a3: Regression guard and per-EP integration test for generateDraft.
 *
 * THE SACRED REGRESSION GUARD (Contract 5):
 *   A degenerate pipeline (no skips, single model) MUST produce exactly ONE
 *   callOpenRouter call with all active sections. This test failing = blocker.
 *
 * Strategy: mock global fetch (what callOpenRouter uses internally) and count
 * how many times it is called. Each callOpenRouter = one fetch call.
 */

import { it, expect, describe, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { generateDraft, type RoundData, type RoundBundleEntry } from './llm.js';
import { DEFAULT_PIPELINE, type Pipeline } from './pipeline.js';

// Helper to build a minimal RoundData.
function mkBundleEntry(round_number: number, name: string, opts: Partial<RoundBundleEntry> = {}): RoundBundleEntry {
  return { round_number, name, top3: [], bottom1: null, winner: null, isCurrent: false, isPrev: false, ...opts };
}

function mkData(over: Partial<RoundData> = {}): RoundData {
  return {
    round: { id: 3, name: 'Test Round', description: null },
    league: { id: 1, name: 'Test League' },
    roundSequence: { number: 1, total: 1 },
    priorRounds: [],
    bundle: [mkBundleEntry(1, 'Test Round', { isCurrent: true })],
    submissions: [],
    votes: [],
    chatMentions: [],
    relContext: '',
    ...over,
  };
}

// Build a fake response body for N sections.
function makeFetchResponse(sectionKinds: string[]): Response {
  const sections: Record<string, unknown> = {};
  for (const k of sectionKinds) {
    sections[k] = { title: k, body: `body for ${k}`, items: [] };
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

// Build a DB mock that returns the given pipeline JSON and resolves all models to 'test-model'.
function makeDbWithPipeline(pipelineJson: string, sectionPins: Record<string, string> = {}): Database.Database {
  const bucketModel = 'test-model';
  return {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn((key: string) => {
        if (sql.toLowerCase().includes('settings')) {
          if (key === 'pipeline_config') return { value: pipelineJson };
          const pinned = sectionPins[key];
          if (pinned) return { value: pinned };
          if (key === 'digest_model') return { value: bucketModel };
          if (key === 'predict_model') return { value: bucketModel };
          return undefined;
        }
        if (sql.includes('league_id')) return { league_id: 1 };
        return undefined;
      }),
      all: vi.fn(() => []),
      run: vi.fn(),
    })),
    exec: vi.fn(),
  } as unknown as Database.Database;
}

// Track fetch calls across the test.
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

describe('generateDraft — regression guard (Contract 5)', () => {
  it('REGRESSION GUARD: degenerate pipeline (no skips, single model) → exactly 1 fetch (1 callOpenRouter)', async () => {
    const degeneratePipeline: Pipeline = { ...DEFAULT_PIPELINE, skipAfter: {}, covers: [] };
    const db = makeDbWithPipeline(JSON.stringify(degeneratePipeline));

    // One response for the single merged call (5 active sections, no chat).
    fetchResponses.push(makeFetchResponse(['quotes', 'consensus', 'podium', 'villain', 'flow']));

    const result = await generateDraft(mkData(), undefined, undefined, db);

    // Exactly 1 fetch = 1 callOpenRouter.
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Verify the request body includes all 5 active sections in the user message.
    const callArgs = fetchSpy.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg?.content).toMatch(/quotes/);
    expect(userMsg?.content).toMatch(/consensus/);
    expect(userMsg?.content).toMatch(/podium/);
    expect(userMsg?.content).toMatch(/villain/);
    expect(userMsg?.content).toMatch(/flow/);

    // Output must have sections.
    expect(result.sections).toBeDefined();
    expect(result.sections['podium']).toBeDefined();
    expect(result.sections['villain']).toBeDefined();
    expect(result.costUsd).toBeCloseTo(0.01);
  });

  it('REGRESSION GUARD: degenerate pipeline without db → exactly 1 fetch (legacy path)', async () => {
    // Without a db, generateDraft uses the legacy single-call path.
    fetchResponses.push(makeFetchResponse(['quotes', 'consensus', 'podium', 'villain', 'flow']));

    const result = await generateDraft(mkData());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.sections).toBeDefined();
  });
});

describe('generateDraft — one-skip pipeline (DEFAULT_PIPELINE)', () => {
  it('DEFAULT_PIPELINE with 5 active sections (no chat) → exactly 3 fetch calls (EP0 + EP1 + flow cover)', async () => {
    // sprint-44: DEFAULT_PIPELINE now has a flow cover → 3 calls: EP0, EP1, EP2 cover.
    const db = makeDbWithPipeline(JSON.stringify(DEFAULT_PIPELINE));

    // EP0: quotes, consensus, podium (chat not active; skip after chat position still fires)
    fetchResponses.push(makeFetchResponse(['quotes', 'consensus', 'podium']));
    // EP1: villain, flow (merged since same model)
    fetchResponses.push(makeFetchResponse(['villain', 'flow']));
    // EP2: flow cover call
    fetchResponses.push(makeFetchResponse(['flow']));

    const result = await generateDraft(mkData(), undefined, undefined, db);

    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // EP0 call: user message requests only EP0 sections.
    const ep0Body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    const ep0UserMsg = ep0Body.messages.find((m: { role: string }) => m.role === 'user');
    expect(ep0UserMsg?.content).toMatch(/Write 3 sections/);
    expect(ep0UserMsg?.content).toMatch(/quotes/);
    expect(ep0UserMsg?.content).toMatch(/consensus/);
    expect(ep0UserMsg?.content).toMatch(/podium/);
    // villain and flow must NOT be in EP0 user msg sections block.
    const ep0AfterHeader = ep0UserMsg?.content.split('# Write 3 sections')[1] ?? '';
    expect(ep0AfterHeader).not.toMatch(/^- villain:/m);
    expect(ep0AfterHeader).not.toMatch(/^- flow:/m);

    // EP1 call: must include prior-EP context as assistant message.
    const ep1Body = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string);
    const ep1AssistantMsg = ep1Body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(ep1AssistantMsg).toBeDefined();
    // The assistant context must contain the EP0 sections output.
    const ep1Context = JSON.parse(ep1AssistantMsg?.content ?? '{}');
    expect(ep1Context.sections).toBeDefined();

    // EP1 user message requests villain and flow.
    const ep1UserMsg = ep1Body.messages.find((m: { role: string }) => m.role === 'user');
    expect(ep1UserMsg?.content).toMatch(/Write 2 sections/);

    // EP2 (flow cover): assistant context message must be present.
    const ep2Body = JSON.parse(fetchSpy.mock.calls[2][1]!.body as string);
    const ep2AssistantMsg = ep2Body.messages.find((m: { role: string }) => m.role === 'assistant');
    expect(ep2AssistantMsg).toBeDefined();

    // Total cost is sum of all 3 EP calls.
    expect(result.costUsd).toBeCloseTo(0.03);
    // All sections present in result.
    expect(result.sections['quotes']).toBeDefined();
    expect(result.sections['podium']).toBeDefined();
    expect(result.sections['villain']).toBeDefined();
    expect(result.sections['flow']).toBeDefined();
    // Cover output must be in result._covers.
    expect(result._covers?.['flow']).toBeDefined();
  });

  it('EP0 and EP1 use correct label meta: digest:ep0:... and digest:ep1:...; flow cover fires in EP2', async () => {
    // sprint-44: DEFAULT_PIPELINE now produces 3 calls (EP0, EP1, flow cover EP2).
    const db = makeDbWithPipeline(JSON.stringify(DEFAULT_PIPELINE));

    fetchResponses.push(makeFetchResponse(['quotes', 'consensus', 'podium']));
    fetchResponses.push(makeFetchResponse(['villain', 'flow']));
    fetchResponses.push(makeFetchResponse(['flow'])); // cover

    await generateDraft(mkData(), undefined, undefined, db);

    // 3 fetch calls: EP0 group, EP1 group, EP2 cover.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
