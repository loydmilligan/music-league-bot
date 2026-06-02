import { it, expect, describe } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPrompt,
  activeKindsForDraft,
  type RoundData,
  type GenParams,
} from './llm.js';

function mkData(over: Partial<RoundData> = {}): RoundData {
  return {
    round: { id: 3, name: 'Department of Education', description: 'songs about school' },
    league: { id: 1, name: 'Hip Jammers' },
    roundSequence: { number: 3, total: 5 },
    priorRounds: [
      { number: 1, name: 'Your Permanent Record' },
      { number: 2, name: 'Must be love on the brain' },
    ],
    submissions: [
      { artist: 'A', title: 's1', album: null, submitter: 'Sasha', comment: null, vote_total: 9 },
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
    const p = buildUserPrompt(mkData({ roundSequence: { number: 1, total: 5 }, priorRounds: [] }));
    expect(p).toMatch(/FIRST round of the season/);
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
