import { describe, it, expect } from 'vitest';
import { buildRunnerDeps } from './runnerLoop.js';

describe('buildRunnerDeps', () => {
  it('assembles a deps object with every collaborator present', () => {
    const d = buildRunnerDeps();
    for (const k of ['claim','transition','fail','capture','generate','render','leagueConfig','finalize','log','now']) {
      expect(typeof (d as unknown as Record<string, unknown>)[k]).toBe('function');
    }
  });

  it('buildRunnerDeps wires the review-gate + approval collaborators', () => {
    const d = buildRunnerDeps();
    expect(typeof d.structuralReview).toBe('function');
    expect(typeof d.awaitApproval).toBe('function');
    expect(typeof d.awaitReview).toBe('function');
  });
});
