/**
 * sprint-43 a2: Tests for generalized buildUserPrompt (subset-section support).
 */

import { it, expect, describe } from 'vitest';
import {
  buildUserPrompt,
  buildSystemPrompt,
  type RoundData,
  type RoundBundleEntry,
} from './llm.js';
import type { SectionKind } from './llm.js';

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

describe('buildUserPrompt — subset sections (a2)', () => {
  it('when sections=[villain,flow], prompt contains only those two section descriptions', () => {
    const sectionSubset: SectionKind[] = ['villain', 'flow'];
    const prompt = buildUserPrompt(mkData(), undefined, undefined, undefined, sectionSubset);
    expect(prompt).toMatch(/villain/);
    expect(prompt).toMatch(/flow/);
    // Other sections must NOT appear in the "Write N sections" block.
    // Check the "Write 2 sections" header.
    expect(prompt).toMatch(/Write 2 sections/);
    // The podium, consensus, quotes, chat descriptions should NOT be in the sections block.
    // They should only appear if section descriptions leak in — verify via checking the block.
    // Simplest: split at "Write 2 sections" and inspect what follows.
    const afterHeader = prompt.split('# Write 2 sections')[1] ?? '';
    expect(afterHeader).not.toMatch(/^- podium:/m);
    expect(afterHeader).not.toMatch(/^- consensus:/m);
    expect(afterHeader).not.toMatch(/^- quotes:/m);
    expect(afterHeader).not.toMatch(/^- chat:/m);
  });

  it('when sections=[villain,flow], requests only those two JSON keys in system prompt', () => {
    const sectionSubset: SectionKind[] = ['villain', 'flow'];
    const sysPrompt = buildSystemPrompt(sectionSubset);
    expect(sysPrompt).toMatch(/"villain"/);
    expect(sysPrompt).toMatch(/"flow"/);
    expect(sysPrompt).not.toMatch(/"podium"/);
    expect(sysPrompt).not.toMatch(/"consensus"/);
    expect(sysPrompt).not.toMatch(/"quotes"/);
    expect(sysPrompt).not.toMatch(/"chat"/);
  });

  it('when no sections param provided, buildUserPrompt includes all active sections (backward compat)', () => {
    const prompt = buildUserPrompt(mkData());
    // Default: no chat (no chatMentions), so 5 sections expected.
    expect(prompt).toMatch(/Write 5 sections/);
    expect(prompt).toMatch(/podium/);
    expect(prompt).toMatch(/villain/);
    expect(prompt).toMatch(/flow/);
    expect(prompt).toMatch(/consensus/);
    expect(prompt).toMatch(/quotes/);
  });

  it('when no sections param provided, buildSystemPrompt uses all 6 sections (backward compat)', () => {
    const sysPrompt = buildSystemPrompt();
    expect(sysPrompt).toMatch(/"podium"/);
    expect(sysPrompt).toMatch(/"villain"/);
    expect(sysPrompt).toMatch(/"flow"/);
    expect(sysPrompt).toMatch(/"consensus"/);
    expect(sysPrompt).toMatch(/"quotes"/);
    expect(sysPrompt).toMatch(/"chat"/);
  });
});
