import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AwardsConfigMissing, awardsDisabledReason, openAwardStore } from '../../src/awards/store.js';

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
  it('corrupt rounds.json throws (and is never overwritten); missing is empty', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'awards-'));
    const s = openAwardStore(dir);
    expect(s.all()).toEqual([]);
    const file = path.join(dir, 'rounds.json');
    writeFileSync(file, '[{"award": "bbb", trunc');
    expect(() => s.all()).toThrow();
    expect(() => s.get('bbb', 1)).toThrow();
    expect(() => s.put({ award: 'bbb', roundId: 1, candidates: [], picks: {}, approvals: [] })).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('[{"award": "bbb", trunc');
    writeFileSync(file, '{"not": "a list"}');
    expect(() => s.all()).toThrow();
  });
  it('awardsDisabledReason: no config vs bad config vs ok', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'awards-'));
    const s = openAwardStore(dir);
    expect(awardsDisabledReason(s)).toBe('[awards] disabled: no config');
    writeFileSync(path.join(dir, 'config.json'), '{bad');
    expect(awardsDisabledReason(s)).toBe('[awards] disabled: bad config (SyntaxError)');
    writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
    expect(awardsDisabledReason(s)).toBeNull();
  });
});
