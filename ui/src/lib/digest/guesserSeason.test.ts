import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSeasonPanel, shortNames, incomingByTarget } from './guesserSeason.js';
import type { GuesserGrid } from '../db/guesserInsights.js';

/**
 * The season panel is a re-reading of real data, so it is tested against the
 * real data: the frozen R150 payload every mock in the design handoff was drawn
 * against. Each expectation below is a number a reader can see on the rendered
 * tab — if the derivation drifts, the page starts lying about the season.
 */
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../design/design_handoff_guesser_viz/data/guesser-viz-data.json', import.meta.url),
    ),
    'utf8',
  ),
);
const live: GuesserGrid = fixture.live_round150.seasonGrid;
const thin: GuesserGrid = fixture.thin_earlySeason.seasonGrid;

describe('shortNames', () => {
  it('keeps first names when the room has only one of them', () => {
    const s = shortNames(['Conor Johnston', 'Grant Koziol', 'Jimmy']);
    expect(s.get('Conor Johnston')).toBe('Conor');
    expect(s.get('Grant Koziol')).toBe('Grant');
    expect(s.get('Jimmy')).toBe('Jimmy');
  });

  it('falls back to surnames for a shared first name, and ONLY for those two', () => {
    const s = shortNames(['Dave Jensen', 'Dave Steingart', 'Jon Black']);
    expect(s.get('Dave Jensen')).toBe('Jensen');
    expect(s.get('Dave Steingart')).toBe('Steingart');
    // The collision must not spill onto everyone else.
    expect(s.get('Jon Black')).toBe('Jon');
  });

  it('applies a league nickname override only inside that league', () => {
    expect(shortNames(['Darren Paletz'], 'boarz-ii-men').get('Darren Paletz')).toBe('Paletz');
    expect(shortNames(['Darren Paletz'], 'sssc').get('Darren Paletz')).toBe('Darren');
  });
});

describe('incomingByTarget', () => {
  it('re-files guesses under who they were aimed at, not who made them', () => {
    const inc = incomingByTarget(live);
    // Steingart never guessed much but is guessed AT six times.
    expect(inc.get('Dave Steingart')!.length).toBe(6);
    // Every entry is credited to the row it came from.
    const matt = inc.get('Conor Johnston')!.filter((g) => g.guesser === 'Matt Mariani');
    expect(matt.length).toBeGreaterThan(0);
    expect(matt.every((g) => g.guessedName.length > 0)).toBe(true);
  });

  it('never counts a guess under the name that was SAID when it was wrong', () => {
    const inc = incomingByTarget(live);
    // Conor is the room's default wrong answer (8 times), but that must land in
    // other people's incoming lists, never inflate his own.
    expect(inc.get('Conor Johnston')!.length).toBe(6);
  });
});

describe('buildSeasonPanel · by-player cards', () => {
  const p = buildSeasonPanel(live, 'boarz-ii-men');

  it('keeps every player, including the four who never guessed', () => {
    expect(p.cards.length).toBe(live.rows.length);
    const never = p.cards.filter((c) => c.attempts === 0);
    expect(never.map((c) => c.short).sort()).toEqual(['Grant', 'Jimmy', 'Paletz', 'Shane']);
    expect(never.every((c) => c.figure === 'never guessed')).toBe(true);
    // The finding is that they are silent as GUESSERS while still being guessed at.
    expect(never.every((c) => c.incoming.length > 0)).toBe(true);
  });

  it('prints a percentage only once the sample can carry one', () => {
    const matt = p.cards.find((c) => c.short === 'Matt')!;
    expect(matt.figure).toBe('18/38 · 47%');
    const clements = p.cards.find((c) => c.short === 'Clements')!;
    expect(clements.attempts).toBe(2);
    expect(clements.figure).toBe('1/2');
    expect(clements.figure).not.toContain('%');
  });

  it('lays one pip per round, in round order, with sat-out rounds preserved', () => {
    const matt = p.cards.find((c) => c.short === 'Matt')!;
    expect(matt.cells.length).toBe(live.rounds.length);
    expect(matt.cells.map((c) => c.tone)).toEqual([
      'out',
      'ember',
      'ember',
      'out',
      'amber',
      'amber',
      'moss',
      'moss',
    ]);
    expect(matt.cells[6].title).toBe('R7: 5/9 right');
    expect(matt.cells[0].title).toBe('R1: no guess');
  });

  it('flags the hand-authored cell instead of printing its computed fraction', () => {
    const jensen = p.cards.find((c) => c.short === 'Jensen')!;
    const over = jensen.cells.filter((c) => c.overridden);
    expect(over.length).toBe(1);
    expect(over[0].title).toContain('1/');
    expect(over[0].title).not.toBe('R6: 1/3 right');
  });

  it('names the guesser, not the target, in each incoming pip tooltip', () => {
    const jon = p.cards.find((c) => c.short === 'Jon')!;
    const nailed = jon.incoming.filter((g) => g.correct);
    expect(nailed.length).toBeGreaterThan(0);
    expect(nailed[0].title).toMatch(/guessed you: nailed you$/);
    const missed = jon.incoming.find((g) => !g.correct)!;
    expect(missed.title).toMatch(/thought you were /);
    expect(missed.title).not.toMatch(/thought you were Jon/);
  });
});

describe('buildSeasonPanel · the field', () => {
  const p = buildSeasonPanel(live, 'boarz-ii-men');

  it('plots only players who have actually guessed', () => {
    expect(p.field.flatMap((d) => d.names).sort()).toEqual(
      ['Clements', 'Conor', 'Jensen', 'Jon', 'Matt', 'Steingart'].sort(),
    );
  });

  it('root-scales volume so the busiest guesser does not flatten the rest', () => {
    const matt = p.field.find((d) => d.names.includes('Matt'))!;
    const conor = p.field.find((d) => d.names.includes('Conor'))!;
    expect(matt.x).toBe(1);
    // Linear scaling would put Conor's 10 guesses at 0.26; the root puts him
    // halfway across, which is the whole point of choosing it.
    expect(conor.x).toBeCloseTo(Math.sqrt(10 / 38), 3);
    expect(conor.x).toBeGreaterThan(0.4);
  });

  it('merges players who land on the identical spot into one labelled dot', () => {
    const shared = p.field.find((d) => d.names.length > 1)!;
    expect(shared.names.sort()).toEqual(['Clements', 'Steingart']);
    expect(shared.label).toContain('Clements');
    expect(shared.label).toContain('Steingart');
    // ...and the merge must not duplicate the dot.
    expect(p.field.filter((d) => d.names.includes('Steingart')).length).toBe(1);
  });

  it('marks the coin-flip samples as thin rather than crowning them', () => {
    const shared = p.field.find((d) => d.names.includes('Clements'))!;
    expect(shared.rate).toBe(0.5);
    expect(shared.thin).toBe(true);
    expect(shared.tone).toBe('quiet');
    // Conor's 60% over 10 is the same neighbourhood of rate and must NOT be dimmed.
    const conor = p.field.find((d) => d.names.includes('Conor'))!;
    expect(conor.thin).toBe(false);
    expect(conor.tone).toBe('moss');
  });
});

describe('buildSeasonPanel · targets', () => {
  const p = buildSeasonPanel(live, 'boarz-ii-men');

  it('reports how often the room names each player right, hardest first', () => {
    expect(p.targets.map((t) => `${t.short} ${t.correct}/${t.attempts}`)).toEqual([
      'Steingart 0/6',
      'Paletz 2/9',
      'Clements 1/4',
      'Jensen 3/9',
      'Grant 3/6',
      'Shane 4/8',
      'Jimmy 6/9',
      'Jon 4/5',
      'Conor 5/6',
    ]);
  });

  it('holds back targets nobody has aimed at enough to measure', () => {
    expect(p.targets.some((t) => t.short === 'Matt')).toBe(false);
    expect(p.targetsHeldBack).toEqual([{ short: 'Matt', attempts: 2 }]);
  });

  it('names who each player is most often mistaken for', () => {
    expect(p.targets.find((t) => t.short === 'Steingart')!.mistakenFor).toBe('Paletz');
    expect(p.targets.find((t) => t.short === 'Jimmy')!.mistakenFor).toBe('Conor');
  });

  it('claims no pattern when the misses are a tie', () => {
    // Shane's four misses are four different names, one each. Any winner there
    // is alphabetical noise printed as a finding.
    const shane = p.targets.find((t) => t.short === 'Shane')!;
    expect(shane.correct).toBe(4);
    expect(shane.mistakenFor).toBeNull();
  });
});

describe('buildSeasonPanel · carrot box', () => {
  const p = buildSeasonPanel(live, 'boarz-ii-men');

  it('takes the ghost and the transparent one from the measured ends of the same list', () => {
    expect(p.ghost!.short).toBe('Steingart');
    expect(p.ghost!.correct).toBe(0);
    expect(p.transparent!.short).toBe('Conor');
    expect(p.transparent!.correct).toBe(5);
    expect(p.ghost).toBe(p.targets[0]);
    expect(p.transparent).toBe(p.targets[p.targets.length - 1]);
  });

  it('counts throw-offs as guesses aimed at you and missed', () => {
    expect(p.throwOffs.slice(0, 3).map((t) => `${t.short} ${t.misses}`)).toEqual([
      'Paletz 7',
      'Jensen 6',
      'Steingart 6',
    ]);
    expect(p.totalMisses).toBe(p.throwOffs.reduce((n, t) => n + t.misses, 0));
  });

  it('finds the hub the room keeps swapping, with both its spokes', () => {
    expect(p.interchangeables).toEqual({
      hub: 'Paletz',
      spokes: [
        { name: 'Clements', count: 4 },
        { name: 'Steingart', count: 4 },
      ],
    });
  });

  it('counts the default guess in the blurted direction, not the guessed-at one', () => {
    // Conor is said wrongly 8 times, while his OWN songs are missed just once.
    expect(p.defaultGuess).toEqual({ short: 'Conor', count: 8 });
    expect(p.throwOffs.find((t) => t.short === 'Conor')!.misses).toBe(1);
  });
});

describe('buildSeasonPanel · a sparse early season', () => {
  const p = buildSeasonPanel(thin, 'boarz-ii-men');

  it('survives a season with almost nothing in it', () => {
    expect(p.cards.length).toBe(thin.rows.length);
    expect(p.cards.every((c) => c.cells.length === thin.rounds.length)).toBe(true);
  });

  it('refuses to crown anyone off one or two guesses', () => {
    expect(p.cards.every((c) => !c.figure.includes('%') || c.attempts >= 3)).toBe(true);
    expect(p.field.every((d) => !d.thin || d.tone === 'quiet')).toBe(true);
  });

  it('never invents an award out of an empty field', () => {
    if (!p.targets.length) {
      expect(p.ghost).toBeNull();
      expect(p.transparent).toBeNull();
    }
    if (!p.totalMisses) expect(p.interchangeables).toBeNull();
  });
});

describe('buildSeasonPanel · an empty grid', () => {
  it('returns empty everything rather than throwing', () => {
    const p = buildSeasonPanel({ rounds: [], rows: [] });
    expect(p.cards).toEqual([]);
    expect(p.field).toEqual([]);
    expect(p.targets).toEqual([]);
    expect(p.ghost).toBeNull();
    expect(p.defaultGuess).toBeNull();
    expect(p.interchangeables).toBeNull();
    expect(p.totalMisses).toBe(0);
  });
});
