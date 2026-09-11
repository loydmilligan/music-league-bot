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
  it('ambiguity: longest-label match wins over shorter when both players named', () => {
    // Comment names both Poetry in Noise (15 chars normalized) and bagimation (10 chars).
    // Both playerId 1 and 2 match, but longest label wins.
    expect(m('Could be Poetry in Noise or bagimation, not sure.')).toBe(1);
  });
});

describe('buildGuessMatcher: real production cases (round 163)', () => {
  describe('spacing — guesser adds spaces, roster label is concatenated', () => {
    const m = buildGuessMatcher([
      { playerId: 1, label: 'PoetryinNoise' },
      { playerId: 2, label: 'Timmywhatup' },
      { playerId: 3, label: 'antigravpjs' },
      { playerId: 4, label: 'GoodGollyMiss' },
    ]);
    it('matches "Poetry in Noise" against PoetryinNoise', () => {
      expect(m('Poetry in Noise! Coffee Tattoos...')).toBe(1);
    });
    it('matches "Timmy what up" against Timmywhatup', () => {
      expect(m('Timmy what up! This one hit')).toBe(2);
    });
    it('matches "Anti Grav PJs" against antigravpjs', () => {
      expect(m('Anti Grav PJs. The musicality')).toBe(3);
    });
    it('matches "Good Golly Miss" against GoodGollyMiss', () => {
      expect(m('Good Golly Miss coming for the crown')).toBe(4);
    });
  });

  describe('typos — one edit off from the roster label', () => {
    const m = buildGuessMatcher([
      { playerId: 5, label: 'a1mrson' },
      { playerId: 6, label: 'dubs613' },
      { playerId: 7, label: 'jirafa' },
    ]);
    it('matches "a1merson" (extra char) against a1mrson', () => {
      expect(m('a1merson! Welcome to the league')).toBe(5);
    });
    it('matches "Dubsc613" (extra char) against dubs613', () => {
      expect(m('Dubsc613, big DUB')).toBe(6);
    });
    it('matches "Jiraffa" (extra char) against jirafa', () => {
      expect(m('Jiraffa! Appreciate you')).toBe(7);
    });
  });

  describe('false-positive guards', () => {
    it('does not fuzzy-match an unrelated word to a >=5-char label', () => {
      const m = buildGuessMatcher([{ playerId: 8, label: 'Aniss' }]);
      expect(m('this song is oddly nostalgic')).toBeNull();
    });
    it('does not match a short (<5 char) label mid-word (no fuzzy, whole-word only)', () => {
      const m = buildGuessMatcher([{ playerId: 9, label: 'Cid' }]);
      expect(m('acidic guitars')).toBeNull();
    });
    it('DOES match a whole-word mention even if it is also a substring elsewhere (not a false positive)', () => {
      const m = buildGuessMatcher([{ playerId: 8, label: 'Cherry' }]);
      expect(m('cherry on top of the sundae')).toBe(8);
    });
  });
  describe('possessives — Second Best\'s two Sarahs', () => {
    // "Sarah S" is Sarah Black's roster name; "Sarah" is Sarah Zucker's.
    const m = buildGuessMatcher([
      { playerId: 10, label: 'Sarah' },
      { playerId: 9, label: 'Sarah S' },
    ]);
    it("credits Sarah's (possessive) to Sarah Zucker, not Sarah S", () => {
      expect(m("Sarah's, obviously")).toBe(10);
      expect(m('Sarah\u2019s, obviously')).toBe(10);
    });
    it('still credits a literal "Sarah S" to Sarah Black', () => {
      expect(m('Gotta be Sarah S')).toBe(9);
    });
  });
});

// ── exactOnly ─────────────────────────────────────────────────────────────────
//
// Fuzzy matching refuses to turn an English WORD into a name, but the list it
// checks holds only the 10k most common words — so a coined nickname can still
// fuzz into something that is obviously not a guess. All three cases below were
// live in the Boarz corpus the day the aliases were added.
describe('exactOnly candidates', () => {
  const match = buildGuessMatcher([
    { playerId: 30, label: 'Koshel', exactOnly: true },
    { playerId: 32, label: 'Conie', exactOnly: true },
    { playerId: 33, label: 'Stein', exactOnly: true },
  ]);

  it('still resolves the nickname as written', () => {
    expect(match('good enough to overcome that, koshel')).toBe(30);
    expect(match('Conie no play right')).toBe(32);
    expect(match('new to me - stein')).toBe(33);
  });

  it('does not reach a real word one edit away', () => {
    // "kosher" -> Koshel, and it is not in the common-word list.
    expect(match('a kosher deli')).toBeNull();
    // JB wrote "Con Te Partirò" in R145; despaced, "Con Te" -> "conte" -> Conie.
    expect(match('The one submission known to me besides Tequila and Con Te Partito')).toBeNull();
    expect(match('stain')).toBeNull();
  });

  it('leaves fuzzy matching on for candidates that did not opt in', () => {
    const fuzzy = buildGuessMatcher([{ playerId: 30, label: 'Koshel' }]);
    expect(fuzzy('a kosher deli')).toBe(30);
  });
});
