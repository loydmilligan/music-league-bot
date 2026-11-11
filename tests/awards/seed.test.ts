import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openAwardStore } from '../../src/awards/store.js';
import { seedCandidates, type SeedRow } from '../../scripts/awards-seed.js';

const rows: SeedRow[] = Array.from({ length: 10 }, (_, i) => ({
  rank: i + 1, who: `Person${i}`, text: `invented line ${i}`, key: `${1760000000 + i * 60}-${i}`,
}));

describe('awards seed', () => {
  it('adds 10 candidates in rank order and is idempotent', () => {
    const store = openAwardStore(mkdtempSync(path.join(os.tmpdir(), 'seed-')));
    const shuffled = [...rows].reverse();
    expect(seedCandidates(store, 5, 'bbb', shuffled)).toEqual({ added: 10, duplicates: 0 });
    const r = store.get('bbb', 5);
    expect(r.candidates.map((c) => c.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.candidates[0]).toMatchObject({
      who: 'Person0', authorId: null, msgId: null, text: 'invented line 0',
      ts: new Date(1760000000 * 1000).toISOString(),
      reactions: [{ emoji: '😂', who: ['Berto'] }],
    });
    expect(seedCandidates(store, 5, 'bbb', rows)).toEqual({ added: 0, duplicates: 10 });
    expect(store.get('bbb', 5).candidates).toHaveLength(10);
  });
});
