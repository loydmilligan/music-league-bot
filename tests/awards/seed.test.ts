import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openAwardStore } from '../../src/awards/store.js';
import { loadTop10, parseSeedArgs, seedCandidates, type SeedRow } from '../../scripts/awards-seed.js';

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

  it('validates every row before writing anything', () => {
    const store = openAwardStore(mkdtempSync(path.join(os.tmpdir(), 'seed-')));
    const bad = [...rows.slice(0, 2), { ...rows[2], key: 'abc' }];
    expect(() => seedCandidates(store, 5, 'bbb', bad)).toThrow('row 3: bad key');
    expect(() => seedCandidates(store, 5, 'bbb', [{ ...rows[0], key: undefined as unknown as string }])).toThrow('row 1: bad key');
    expect(() => seedCandidates(store, 5, 'bbb', [{ ...rows[0], text: ' ' }])).toThrow('row 1: bad row');
    expect(() => seedCandidates(store, 5, 'bbb', [{ ...rows[0], who: '' }])).toThrow('row 1: bad row');
    expect(store.all()).toEqual([]);
  });

  it('empty list writes nothing', () => {
    const store = openAwardStore(mkdtempSync(path.join(os.tmpdir(), 'seed-')));
    expect(seedCandidates(store, 5, 'bbb', [])).toEqual({ added: 0, duplicates: 0 });
    expect(store.all()).toEqual([]);
  });

  it('loadTop10 reports unreadable files and missing lists', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    const missing = path.join(dir, 'nope.json');
    expect(() => loadTop10(missing)).toThrow(`can't read ${missing}:`);
    const junk = path.join(dir, 'junk.json');
    writeFileSync(junk, '{oops');
    expect(() => loadTop10(junk)).toThrow(`can't read ${junk}:`);
    const nolist = path.join(dir, 'nolist.json');
    writeFileSync(nolist, JSON.stringify({ top10: 'x' }));
    expect(() => loadTop10(nolist)).toThrow(`no top10 list in ${nolist}`);
    const ok = path.join(dir, 'ok.json');
    writeFileSync(ok, JSON.stringify({ top10: [] }));
    expect(loadTop10(ok)).toEqual([]);
  });

  it('parseSeedArgs validates --round and --award', () => {
    expect(parseSeedArgs(['f.json', '--round', '7'], ['bbb', 'hba'])).toEqual({ file: 'f.json', award: 'bbb', roundId: 7 });
    expect(parseSeedArgs(['f.json', '--award', 'hba'], ['bbb', 'hba']).roundId).toBeUndefined();
    for (const r of ['0', '-1', '1.5', 'x', '']) expect(() => parseSeedArgs(['f.json', '--round', r], ['bbb'])).toThrow('bad --round');
    expect(() => parseSeedArgs(['f.json', '--round'], ['bbb'])).toThrow('bad --round');
    expect(() => parseSeedArgs(['f.json', '--award', 'zzz'], ['bbb'])).toThrow('unknown award zzz');
  });
});
