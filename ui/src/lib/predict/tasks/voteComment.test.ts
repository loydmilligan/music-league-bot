import { it, expect, vi, beforeEach, describe } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openLeagueDb } from '$lib/db/client.js';

const db = openLeagueDb(':memory:');

vi.mock('$lib/digest/llm.js', () => ({
  callOpenRouter: vi.fn(),
}));

import { callOpenRouter } from '$lib/digest/llm.js';
const mockCallOpenRouter = vi.mocked(callOpenRouter);

import {
  VoteCommentOutputSchema,
  voteCommentTask,
  buildVoteCommentMessages,
  runVoteComment,
} from './voteComment.js';
import type { VoteCommentInput } from './voteComment.js';

const BASE: VoteCommentInput = {
  song: { title: 'Song A', artist: 'Artist A', spotifyUri: 'spotify:track:123abc' },
  theme: { name: 'Non-English', description: 'Songs not in English' },
  rating: 4,
  notes: 'the drum machine carries it',
  upPoints: 2,
  downPoints: 0,
  voiceSample: ['Absolute banger, no notes.', 'This one lost me at the sax solo.'],
};

function llmResult(draft: string) {
  return { content: JSON.stringify({ draft }), costUsd: 0.001, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 };
}

// ── Schema / prompt-builder tests (task brief) ─────────────────────────────

it('accepts a draft', () => {
  expect(VoteCommentOutputSchema.parse({ draft: 'That drum machine does all the work — love it.' }).draft).toBeTruthy();
});

it('rejects an empty draft', () => {
  expect(() => VoteCommentOutputSchema.parse({ draft: '' })).toThrow();
});

it('has a stable task id', () => {
  expect(voteCommentTask.id).toBe('vote-comment');
});

it('includes the voice sample and the user notes in the prompt', () => {
  const all = buildVoteCommentMessages(BASE).map((m) => m.content).join('\n');
  expect(all).toContain('Absolute banger, no notes.');
  expect(all).toContain('the drum machine carries it');
  expect(all).toContain('Song A');
});

it('tells the model this is a downvote when points are negative', () => {
  const all = buildVoteCommentMessages({ ...BASE, upPoints: 0, downPoints: 1 })
    .map((m) => m.content).join('\n').toLowerCase();
  expect(all).toContain('downvote');
});

it('never puts submitter identity in the prompt and forbids revealing it is AI-written', () => {
  const all = buildVoteCommentMessages(BASE).map((m) => m.content).join('\n');
  expect(all).not.toMatch(/submitter|submitted by/i);
  expect(all.toLowerCase()).toContain('ai-written');
});

// ── Caching behavior (user override — brief said "always fresh") ──────────

describe('runVoteComment caching', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM prediction_runs').run();
    vi.clearAllMocks();
  });

  function run(overrides: Partial<VoteCommentInput> = {}, forceRegen = false) {
    const input = { ...BASE, ...overrides };
    return runVoteComment(db, {
      roundId: 1,
      song: input.song,
      theme: input.theme,
      rating: input.rating,
      notes: input.notes,
      upPoints: input.upPoints,
      downPoints: input.downPoints,
      voiceSample: input.voiceSample,
      forceRegen,
    });
  }

  it('caches the draft on identical inputs — second call skips the LLM', async () => {
    mockCallOpenRouter.mockResolvedValueOnce(llmResult('First draft.'));

    const first = await run();
    expect(first.cacheHit).toBe(false);
    expect(first.output.draft).toBe('First draft.');

    const second = await run();
    expect(second.cacheHit).toBe(true);
    expect(second.output.draft).toBe('First draft.');
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });

  it('forceRegen bypasses the cache and calls the LLM again', async () => {
    mockCallOpenRouter
      .mockResolvedValueOnce(llmResult('First draft.'))
      .mockResolvedValueOnce(llmResult('Regenerated draft.'));

    await run();
    const regen = await run({}, true);

    expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
    expect(regen.cacheHit).toBe(false);
    expect(regen.output.draft).toBe('Regenerated draft.');
  });

  it('editing notes produces a fresh draft, not the stale cached one', async () => {
    mockCallOpenRouter
      .mockResolvedValueOnce(llmResult('Draft about the drum machine.'))
      .mockResolvedValueOnce(llmResult('Draft about the new note.'));

    await run();
    const afterEdit = await run({ notes: 'actually the bassline is what does it' });

    expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
    expect(afterEdit.cacheHit).toBe(false);
    expect(afterEdit.output.draft).toBe('Draft about the new note.');
  });

  it('changing the allocation (upPoints/downPoints) produces a fresh draft', async () => {
    mockCallOpenRouter
      .mockResolvedValueOnce(llmResult('Upvote draft.'))
      .mockResolvedValueOnce(llmResult('Downvote draft.'));

    await run({ upPoints: 2, downPoints: 0 });
    const afterRealloc = await run({ upPoints: 0, downPoints: 1 });

    expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
    expect(afterRealloc.cacheHit).toBe(false);
    expect(afterRealloc.output.draft).toBe('Downvote draft.');
  });

  it('changing the rating produces a fresh draft, including from/to null', async () => {
    mockCallOpenRouter
      .mockResolvedValueOnce(llmResult('Rated draft.'))
      .mockResolvedValueOnce(llmResult('Unrated draft.'));

    await run({ rating: 4 });
    const afterRatingChange = await run({ rating: null });

    expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
    expect(afterRatingChange.cacheHit).toBe(false);
    expect(afterRatingChange.output.draft).toBe('Unrated draft.');
  });

  it('a different song (spotifyUri) in the same round does not share a cache entry', async () => {
    mockCallOpenRouter
      .mockResolvedValueOnce(llmResult('Song A draft.'))
      .mockResolvedValueOnce(llmResult('Song B draft.'));

    await run();
    const otherSong = await run({ song: { title: 'Song A', artist: 'Artist A', spotifyUri: 'spotify:track:REMASTER' } });

    expect(mockCallOpenRouter).toHaveBeenCalledTimes(2);
    expect(otherSong.cacheHit).toBe(false);
    expect(otherSong.output.draft).toBe('Song B draft.');
  });

  it('does not return a poisoned (unusable, output_json NULL) row from cache lookup', async () => {
    // Simulate a previous run that failed schema validation twice: predict.ts writes
    // output_json = NULL, outcome = 'unusable' before throwing. It is the newest row
    // matching this exact cache key — it must be excluded, not just deprioritized.
    db.prepare(
      `INSERT INTO prediction_runs (id, task_id, round_id, input_json, output_json, model, cost_usd, latency_ms, created_at, outcome)
       VALUES (?, 'vote-comment', ?, ?, NULL, 'm', 0, 0, ?, 'unusable')`,
    ).run(
      randomUUID(),
      1,
      JSON.stringify({
        song: BASE.song,
        notes: BASE.notes,
        rating: BASE.rating,
        upPoints: BASE.upPoints,
        downPoints: BASE.downPoints,
      }),
      new Date().toISOString(),
    );

    mockCallOpenRouter.mockResolvedValueOnce(llmResult('Fresh draft.'));

    const result = await run();

    expect(result.cacheHit).toBe(false);
    expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);
  });
});
