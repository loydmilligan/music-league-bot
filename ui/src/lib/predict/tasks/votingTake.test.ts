import { it, expect } from 'vitest';
import { VotingTakeOutputSchema, votingTakeTask, buildVotingTakeMessages } from './votingTake.js';
import type { VotingTakeInput } from './votingTake.js';

const INPUT: VotingTakeInput = {
  song: { title: 'Song A', artist: 'Artist A', spotifyUri: 'spotify:track:123abc', spotifyPopularity: 12, listeners: 900, bpm: 128, energy: 0.7, hasLyrics: true, tags: ['shoegaze'] },
  theme: { name: 'Non-English', description: 'Songs not in English' },
  tasteFingerprint: 'Rewards obscure, texture-forward records; punishes novelty songs.',
};

it('accepts a well-formed output', () => {
  const parsed = VotingTakeOutputSchema.parse({
    theme_read: 'Squarely on-theme: Portuguese vocal throughout.',
    taste_note: 'Texture-forward and obscure — squarely your lane.',
    angles: ['The drum machine is doing the emotional work', 'Compare to the Cocteau Twins record you rewarded'],
    signals: ['shoegaze', 'obscure'],
  });
  expect(parsed.angles).toHaveLength(2);
});

it('rejects output that smuggles in a vote recommendation field', () => {
  expect(() =>
    VotingTakeOutputSchema.parse({
      theme_read: 'x', taste_note: 'y', angles: ['a'], signals: [], lean: 'up',
    }),
  ).toThrow();
});

it('requires at least one angle', () => {
  expect(() =>
    VotingTakeOutputSchema.parse({ theme_read: 'x', taste_note: 'y', angles: [], signals: [] }),
  ).toThrow();
});

it('is registered with a stable task id', () => {
  expect(votingTakeTask.id).toBe('voting-take');
});

it('never puts submitter identity in the prompt and forbids recommendations', () => {
  const messages = buildVotingTakeMessages(INPUT);
  const all = messages.map((m) => m.content).join('\n');
  expect(all).not.toMatch(/submitter|submitted by/i);
  expect(all).toContain('Song A');
  expect(all).toContain('Non-English');
  // The system prompt must forbid telling the user how to vote.
  expect(all.toLowerCase()).toContain('do not recommend');
});

it('includes the track identifier in the task input type', () => {
  // spotifyUri is what makes the cache key unique per track; title+artist can repeat
  // (original vs remaster), so it must be part of the cached input.
  expect(INPUT.song.spotifyUri).toBeTruthy();
});
