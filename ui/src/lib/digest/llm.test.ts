import { it, expect, describe } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  activeKindsForDraft,
  enrichPodiumArt,
  type RoundData,
  type GenParams,
  type RoundBundleEntry,
} from './llm.js';

function sub(title: string, art: string | null, vote: number): RoundData['submissions'][number] {
  return { artist: 'X', title, album: null, submitter: 's', comment: null, vote_total: vote, spotifyUri: `spotify:track:${title}`, albumArtUrl: art };
}

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

describe('system prompt — ML rules', () => {
  const sys = buildSystemPrompt();
  it('forbids self-vote claims', () => {
    expect(sys).toMatch(/CANNOT vote on their own submission/i);
  });
  it('explains the max-one-downvote rule', () => {
    expect(sys).toMatch(/at most ONE downvote/i);
    expect(sys).toMatch(/not a noteworthy scarcity/i);
  });
  it('requires first-listed artist for multi-artist songs', () => {
    expect(sys).toMatch(/FIRST listed artist/i);
  });
  it('states the chronology rule', () => {
    expect(sys).toMatch(/never a later one/i);
  });
});

describe('user prompt — chronology', () => {
  it('states the current round sequence and anchors "last round"', () => {
    const p = buildUserPrompt(mkData());
    expect(p).toMatch(/round 3 of 5/);
    expect(p).toMatch(/Round 1: Your Permanent Record/);
    expect(p).toMatch(/Round 2: Must be love on the brain/);
    expect(p).toMatch(/"Last round" = Round 2: Must be love on the brain/);
    expect(p).toMatch(/Do not reference any round after round 3/);
  });
  it('notes a first round has no prior round', () => {
    const p = buildUserPrompt(mkData({
      roundSequence: { number: 1, total: 5 },
      priorRounds: [],
      bundle: [mkBundleEntry(1, 'Department of Education', { isCurrent: true })],
    }));
    expect(p).toMatch(/FIRST round of the season/);
  });
  it('presents the cross-round record as the only fact source', () => {
    const p = buildUserPrompt(mkData());
    expect(p).toMatch(/Cross-round record/);
    expect(p).toMatch(/ONLY SOURCE of cross-round facts/);
  });
  it('flags relContext as personality context, not cross-round facts', () => {
    const p = buildUserPrompt(mkData({ relContext: 'Alice loves 80s bangers' }));
    expect(p).toMatch(/personality and tone context only/i);
    expect(p).toMatch(/NOT a source of cross-round facts/i);
    expect(p).toMatch(/Alice loves 80s bangers/);
  });
});

describe('generation params', () => {
  it('omits a disabled section from the active set', () => {
    const params: GenParams = { sections: [{ id: 'villain', enabled: false }] };
    const kinds = activeKindsForDraft(mkData(), params);
    expect(kinds).not.toContain('villain');
    expect(kinds).toContain('podium');
  });

  it('includes chat when pastedChat is supplied even with no auto-captured mentions', () => {
    const params: GenParams = { pastedChat: 'Alice: this round slapped' };
    const kinds = activeKindsForDraft(mkData({ chatMentions: [] }), params);
    expect(kinds).toContain('chat');
  });

  it('excludes chat with neither mentions nor pasted text', () => {
    expect(activeKindsForDraft(mkData({ chatMentions: [] }))).not.toContain('chat');
  });

  it('injects per-section style words and context into the section instructions', () => {
    const params: GenParams = {
      sections: [{ id: 'podium', enabled: true, style: ['mean', 'concise'], context: 'note the upset' }],
    };
    const p = buildUserPrompt(mkData(), undefined, params);
    expect(p).toMatch(/style\/focus — lean into: mean, concise/);
    expect(p).toMatch(/extra context: note the upset/);
  });

  it('feeds pasted chat into the prompt as the chat-section source', () => {
    const params: GenParams = { pastedChat: 'Bob: banger alert' };
    const p = buildUserPrompt(mkData(), undefined, params);
    expect(p).toMatch(/Pasted WhatsApp chat/);
    expect(p).toMatch(/Bob: banger alert/);
  });
});

describe('chat-restructure shape (sprint-15)', () => {
  it('system prompt declares the chat section as { summary, moments[{label,detail}] }', () => {
    const sys = buildSystemPrompt();
    expect(sys).toMatch(/"chat":\s*\{ "title": string, "summary": string, "moments": \[\{"label": string, "detail": string\}\] \}/);
  });
});

describe('podium album-art enrichment (sprint-15)', () => {
  it('matches items to submissions by title, falls back to vote-rank position, and never overrides existing art', () => {
    const subs = [sub('Chaise Longue', 'http://art/1', 9), sub('Teenage Dirtbag', 'http://art/2', 7)];
    const content = {
      items: [
        { title: 'Chaise Longue' },          // title match → art/1
        { title: 'Some Unlisted Song' },      // no match → position idx1 → art/2
        { title: 'whatever', coverUrl: 'KEEP' }, // already has art → untouched
      ],
    };
    enrichPodiumArt(content, subs);
    expect(content.items[0].coverUrl).toBe('http://art/1');
    expect(content.items[1].coverUrl).toBe('http://art/2');
    expect(content.items[2].coverUrl).toBe('KEEP');
  });

  it('is a no-op when there is no art and when content is malformed', () => {
    const subs = [sub('A', null, 5)];
    const content = { items: [{ title: 'A' }] };
    enrichPodiumArt(content, subs);
    expect((content.items[0] as Record<string, unknown>).coverUrl).toBeUndefined();
    expect(() => enrichPodiumArt(null, subs)).not.toThrow();
    expect(() => enrichPodiumArt({ items: 'nope' }, subs)).not.toThrow();
  });
});
