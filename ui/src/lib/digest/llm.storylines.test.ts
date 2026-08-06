import { describe, it, expect } from 'vitest';
import {
  activeKindsForDraft,
  buildUserPrompt,
  type RoundData,
  type GenParams,
  type RoundBundleEntry,
} from './llm.js';
import type { StorylineEvidence } from './storylineEvidence.js';

function mkBundleEntry(round_number: number, name: string, opts: Partial<RoundBundleEntry> = {}): RoundBundleEntry {
  return { round_number, name, top3: [], bottom1: null, winner: null, isCurrent: false, isPrev: false, ...opts };
}

function mkData(over: Partial<RoundData> = {}): RoundData {
  return {
    round: { id: 3, name: 'Department of Education', description: 'songs about school' },
    league: { id: 1, name: 'Hip Jammers' },
    roundSequence: { number: 3, total: 5 },
    priorRounds: [
      { number: 1, name: 'Your Permanent Record' },
      { number: 2, name: 'Must be love on the brain' },
    ],
    bundle: [
      mkBundleEntry(1, 'Your Permanent Record', { isPrev: false }),
      mkBundleEntry(2, 'Must be love on the brain', { isPrev: true }),
      mkBundleEntry(3, 'Department of Education', { isCurrent: true }),
    ],
    submissions: [
      { artist: 'A', title: 's1', album: null, submitter: 'Sasha', comment: null, vote_total: 9, spotifyUri: 'spotify:track:s1', albumArtUrl: null },
    ],
    votes: [{ voter: 'Ronm', song: 's1', points: 3, comment: 'great' }],
    chatMentions: [],
    relContext: '',
    ...over,
  };
}

const oneSeed: StorylineEvidence[] = [
  {
    player: 'PoetryinNoise',
    motif: 'cats',
    quotes: [
      { text: 'my cat approves of this pick', ts: '2026-08-01T12:00:00Z', source: 'chat' },
    ],
  },
];

describe('activeKindsForDraft — storylines evidence gate', () => {
  it('includes storylines when storylineEvidence has at least one seed', () => {
    const kinds = activeKindsForDraft(mkData({ storylineEvidence: oneSeed }));
    expect(kinds).toContain('storylines');
  });

  it('excludes storylines when storylineEvidence is an empty array', () => {
    const kinds = activeKindsForDraft(mkData({ storylineEvidence: [] }));
    expect(kinds).not.toContain('storylines');
  });

  it('excludes storylines when storylineEvidence is undefined', () => {
    const kinds = activeKindsForDraft(mkData());
    expect(kinds).not.toContain('storylines');
  });

  it('excludes storylines when disabled via genParams.sections even with evidence present', () => {
    const params: GenParams = { sections: [{ id: 'storylines', enabled: false }] };
    const kinds = activeKindsForDraft(mkData({ storylineEvidence: oneSeed }), params);
    expect(kinds).not.toContain('storylines');
  });
});

describe('buildUserPrompt — storylines evidence block', () => {
  it('appends a bounded storylines evidence block when the kind is active', () => {
    const data = mkData({ storylineEvidence: oneSeed });
    const p = buildUserPrompt(data, undefined, undefined, undefined, ['storylines']);
    expect(p).toMatch(/Storylines evidence/i);
    expect(p).toMatch(/PoetryinNoise — cats/);
    expect(p).toMatch(/my cat approves of this pick/);
    expect(p).toMatch(/do not invent/i);
  });

  it('omits the storylines evidence block when there is no evidence', () => {
    const data = mkData();
    const p = buildUserPrompt(data, undefined, undefined, undefined, ['podium']);
    expect(p).not.toMatch(/Storylines evidence/i);
  });
});
