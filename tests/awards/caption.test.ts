import { describe, expect, it } from 'vitest';
import { buildCaption } from '../../src/awards/caption.js';
import type { AwardDef, AwardRound } from '../../src/awards/types.js';

const def: AwardDef = { key: 'bbb', prefix: 'bbb', name: 'BBB', owners: [], approvers: [], day: 1, window: 'round', promptTemplate: 'x.md' };
const mk = (n: number, who: string) => ({ n, who, authorId: null, text: 't', ts: '2026-11-01T00:00:00Z', msgId: null, reactions: null });
const r: AwardRound = {
  award: 'bbb', roundId: 7, candidates: [mk(1, 'Ann'), mk(2, 'Bo'), mk(3, 'Cy')], picks: { 1: 2, 2: 3, 3: 1 }, approvals: [],
};
const links = { award: 'https://d/d2/s/?view=awards&src=award#award-bbb', recap: 'https://r/x', digest: 'https://d/d2/s/?src=award' };

describe('buildCaption', () => {
  it('full caption', () => {
    expect(buildCaption(def, r, links)).toBe([
      '🏆 BBB',
      '🥇 Bo · 🥈 Cy · 🥉 Ann',
      '👉 Full award: https://d/d2/s/?view=awards&src=award#award-bbb',
      "☀️ This morning's recap: https://r/x",
      "📰 This round's digest: https://d/d2/s/?src=award",
    ].join('\n'));
  });
  it('omits the recap line when recap is null', () => {
    const c = buildCaption(def, r, { ...links, recap: null });
    expect(c).not.toContain('recap');
    expect(c.split('\n')).toHaveLength(4);
  });
});
