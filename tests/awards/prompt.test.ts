import { describe, it, expect } from 'vitest';
import { fillPrompt, PromptFieldMissing } from '../../src/awards/prompt.js';
import type { AwardDef, Candidate } from '../../src/awards/types.js';

const def = { name: 'Best Banter' } as AwardDef;
const c = (n: number, who: string, text: string, ts: string): Candidate =>
  ({ n, who, authorId: null, text, ts, msgId: null, reactions: null });
const picks = [
  c(1, 'Ann', 'first text', '2026-11-10T21:05:00Z'),
  c(2, 'Bo', 'second text', '2026-11-10T08:30:00Z'),
  c(3, 'Cy', 'third text', '2026-11-10T20:00:00Z'),
];
const avatarFor = (w: string) => `/av/${w}.png`;

describe('fillPrompt', () => {
  it('fills fields and returns avatars in place order', () => {
    const t = 'Award {{AWARD_NAME}}: {{P1_NAME}} "{{P1_TEXT}}" {{P1_TIME}} {{P1_AVATAR}} / {{P2_NAME}} {{P2_TIME}} / {{P3_NAME}} {{P3_AVATAR}} {{AWARD_NAME}}';
    const r = fillPrompt(t, def, picks, avatarFor);
    expect(r.prompt).toBe('Award Best Banter: Ann "first text" 1:05 PM /av/Ann.png / Bo 12:30 AM / Cy /av/Cy.png Best Banter');
    expect(r.avatars).toEqual(['/av/Ann.png', '/av/Bo.png', '/av/Cy.png']);
  });
  it('throws on an unknown field', () => {
    expect(() => fillPrompt('{{AWARD_NAME}} {{MYSTERY}}', def, picks, avatarFor)).toThrow(PromptFieldMissing);
    try { fillPrompt('{{MYSTERY}}', def, picks, avatarFor); } catch (e) { expect((e as PromptFieldMissing).field).toBe('MYSTERY'); }
  });
  it('throws when fewer than 3 picks', () => {
    expect(() => fillPrompt('{{P3_NAME}}', def, picks.slice(0, 2), avatarFor)).toThrow(PromptFieldMissing);
  });
});
