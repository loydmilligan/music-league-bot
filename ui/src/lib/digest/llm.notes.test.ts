import { describe, it, expect } from 'vitest';
import { buildUserPrompt, type GenParams } from './llm.js';
import type { PromptNotes, RoundNote } from './roundNotes.js';
import { makeRoundData } from './llm.test.js';

const T0 = '2026-08-26T00:00:00Z';
const note = (body: string, target: RoundNote['target']): RoundNote =>
  ({ id: body, roundId: 149, target, body, createdAt: T0, updatedAt: T0 });

const empty: PromptNotes = { general: [], bySection: {}, ledes: [] };

describe('note injection', () => {
  it('puts a general note in the prompt', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, general: [note('the mandolin thing', 'general')] });
    expect(p).toContain('the mandolin thing');
  });

  it('wraps every note in the editorial envelope', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, general: [note('x', 'general')] });
    expect(p).toMatch(/not a quotable source/i);
    expect(p).toMatch(/do not attribute/i);
  });

  it('puts a chat-targeted note on the chat section only', () => {
    const notes: PromptNotes = { ...empty, bySection: { chat: [note('chat thing', 'chat')] } };
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['chat', 'podium'], notes);
    const chatLine = p.split('\n').find((l) => l.startsWith('- chat:'))!;
    const podiumLine = p.split('\n').find((l) => l.startsWith('- podium:'))!;
    expect(chatLine).toContain('chat thing');
    expect(podiumLine).not.toContain('chat thing');
  });

  it('never puts a ledes note in a section prompt', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'],
      { ...empty, ledes: [note('lede steer', 'ledes')] });
    expect(p).not.toContain('lede steer');
  });

  it('emits no envelope and no heading when there are no notes', () => {
    const p = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'], empty);
    expect(p).not.toContain('# Editor notes');
  });

  it('is unchanged when the notes argument is omitted entirely', () => {
    const withArg = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium'], empty);
    const without = buildUserPrompt(makeRoundData(), undefined, undefined, undefined, ['podium']);
    expect(without).toBe(withArg);
  });

  it('keeps the existing per-section context alongside a note', () => {
    const genParams: GenParams = {
      sections: [{ id: 'podium', enabled: true, style: [], variant: 'textual', context: 'lean dry' }],
    };
    const p = buildUserPrompt(makeRoundData(), undefined, genParams, undefined, ['podium'],
      { ...empty, bySection: { podium: [note('podium thing', 'podium')] } });
    expect(p).toContain('lean dry');
    expect(p).toContain('podium thing');
  });
});
