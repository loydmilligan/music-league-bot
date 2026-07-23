import { describe, it, expect, vi } from 'vitest';

// The endpoint reads getDb() and builds a brief. We test the handler logic by
// mocking the two collaborators so no real DB/LLM is needed.
vi.mock('$lib/db/client.js', () => ({ getDb: () => ({}) }));
vi.mock('$lib/theme-brief/assemble.js', () => ({
  readCachedBrief: vi.fn(() => null),
  buildThemeBrief: vi.fn(async () => ({ roundId: 145, whatToSubmit: 'go familiar' })),
}));
vi.mock('$lib/theme-brief/llmFn.js', () => ({ makeLlmFn: () => async () => '{}' }));

import { GET, POST } from './+server.js';
import { readCachedBrief, buildThemeBrief } from '$lib/theme-brief/assemble.js';

function evt(roundId: string, body?: unknown) {
  return { params: { roundId }, request: { json: async () => body ?? {} } } as never;
}

describe('theme-brief endpoint', () => {
  it('GET returns generated:false when nothing cached', async () => {
    const res = await GET(evt('145'));
    expect(await res.json()).toEqual({ generated: false });
  });
  it('GET returns the cached brief when present', async () => {
    (readCachedBrief as ReturnType<typeof vi.fn>).mockReturnValueOnce({ roundId: 145, whatToSubmit: 'cached' });
    const res = await GET(evt('145'));
    expect(await res.json()).toMatchObject({ generated: true, brief: { whatToSubmit: 'cached' } });
  });
  it('POST builds and returns a brief', async () => {
    const res = await POST(evt('145', { force: true }));
    expect(await res.json()).toMatchObject({ brief: { whatToSubmit: 'go familiar' } });
  });
  it('POST returns 404 when buildThemeBrief throws (unknown round)', async () => {
    (buildThemeBrief as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('round 999 not found'));
    await expect(POST(evt('999', { force: true }))).rejects.toMatchObject({ status: 404 });
  });
});
