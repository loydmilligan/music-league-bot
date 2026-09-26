import { describe, expect, it, vi } from 'vitest';
import { createJevResponder, extractJevPrompt } from '../src/chat/jevResponder.js';

describe('extractJevPrompt', () => {
  it('accepts explicit commands and supplies a useful default', () => {
    expect(extractJevPrompt('!jev is this getting heated?')).toBe('is this getting heated?');
    expect(extractJevPrompt('!jev')).toBe('Read the current chat vibe.');
  });

  it('stays silent on ordinary chat and accepts a real bot mention', () => {
    expect(extractJevPrompt('jev should see this')).toBeNull();
    expect(extractJevPrompt('@MusicLeagueBot read the room', true)).toBe('read the room');
  });
});

describe('createJevResponder', () => {
  it('returns a compact deterministic read and enforces per-chat cooldown', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
        model: 'typesafe/jev-1.13',
        usage: { cost: 0.0001 },
        answers: {
          heat: { score: 2 }, chaos: { score: 1 }, affection: { score: 3 },
          conversation_pull: { score: 2 }, is_music: { noul: 0.9 }, is_banter: { noul: 0.8 },
        },
      }), { status: 200 }));
    let clock = 100_000;
    const respond = createJevResponder({ apiKey: 'test', fetchImpl, now: () => clock, cooldownMs: 30_000 });
    const request = { chatId: 'group', chatName: 'League', authorId: 'alice', prompt: 'read this', priorMessages: [] };

    await expect(respond(request)).resolves.toContain('friendly knife fight');
    await expect(respond(request)).resolves.toContain('cooling down');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 31_000;
    await respond(request);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
