import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AwardsConfigMissing, openAwardStore } from '../../src/awards/store.js';

const cfg = { postGroup: 'g@g.us', groupName: 'Test', leagueId: 1, digestBaseUrl: 'https://d', recapBaseUrl: 'https://r', awards: [] };

describe('award store', () => {
  it('round-trips rounds and persists across opens', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'awards-'));
    const s = openAwardStore(dir);
    const fresh = s.get('bbb', 3);
    expect(fresh).toEqual({ award: 'bbb', roundId: 3, candidates: [], picks: {}, approvals: [] });
    s.put({ ...fresh, poster: 'p.png' });
    expect(s.get('bbb', 3).poster).toBe('p.png');
    expect(s.all()).toHaveLength(1);
    expect(openAwardStore(dir).get('bbb', 3).poster).toBe('p.png');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('reads config.json and throws AwardsConfigMissing when absent', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'awards-'));
    const s = openAwardStore(dir);
    expect(() => s.config()).toThrow(AwardsConfigMissing);
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
    expect(s.config()).toEqual(cfg);
  });
});
