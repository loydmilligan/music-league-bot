import { describe, it, expect } from 'vitest';
import { buildGuessMatcher } from './guessResolver.js';

const cands = [
  { playerId: 1, label: 'PoetryinNoise' }, { playerId: 1, label: 'Poetry in Noise' },
  { playerId: 2, label: 'bagimation' },
  { playerId: 3, label: 'nowlistenallison' }, { playerId: 3, label: 'zewskers' },
  { playerId: 4, label: 'Lexa Prole' },
];

describe('buildGuessMatcher', () => {
  const m = buildGuessMatcher(cands);
  it('matches a spaced/altered nickname', () => {
    expect(m("I'm gonna guess this one is Poetry in Noise.")).toBe(1);
  });
  it('matches an alias', () => {
    expect(m('Zewskers with the whimsical pick!')).toBe(3); // zewskers -> nowlistenallison
  });
  it('matches a bare name mid-sentence', () => {
    expect(m('This sounds like a Bagimation pull.')).toBe(2);
  });
  it('returns null when no roster name appears', () => {
    expect(m("This song really wasn't about anything.")).toBeNull();
  });
});
