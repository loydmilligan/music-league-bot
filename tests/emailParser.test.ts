import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifySubject,
  unwrapSesUrl,
  parseEmail,
} from '../src/email/emailParser.js';

const fixture = (name: string) =>
  readFileSync(resolve('docs/sample_email', name), 'utf8');

// Real samples committed under docs/sample_email/
const ROUND_STARTING = 'email-29030-20260626-090045.eml'; // Fam Jam IV: Uncharted Tracks - Round Starting
const VOTES_ARE_IN = 'email-29031-20260626-090121.eml'; // Fam Jam IV: Uncharted Tracks - The Votes Are In
const NEW_PLAYLIST = 'email-24488-20260626-090202.eml'; // Hip Jammers 3: its all hippening - New Playlist

// ---------------------------------------------------------------------------
// classifySubject — subject suffix → lifecycle type
// ---------------------------------------------------------------------------

describe('classifySubject', () => {
  it('maps the three lifecycle suffixes', () => {
    expect(classifySubject('Fam Jam IV: Uncharted Tracks - Round Starting')).toBe('round_starting');
    expect(classifySubject('Hip Jammers 3: its all hippening - New Playlist')).toBe('new_playlist');
    expect(classifySubject('Fam Jam IV: Uncharted Tracks - The Votes Are In')).toBe('votes_are_in');
  });

  it('is case-insensitive on the suffix', () => {
    expect(classifySubject('X: y - the votes are in')).toBe('votes_are_in');
  });

  it('everything else is "other"', () => {
    expect(classifySubject('Fam Jam IV: Uncharted Tracks - Someone submitted')).toBe('other');
    expect(classifySubject('Voting ends soon')).toBe('other');
    expect(classifySubject('')).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// unwrapSesUrl — undo the Amazon SES click-tracking redirect
// ---------------------------------------------------------------------------

describe('unwrapSesUrl', () => {
  it('decodes the real URL embedded after /L0/', () => {
    const wrapped =
      'https://zbc66fbs.r.us-east-1.awstrack.me/L0/https:%2F%2Fapp.musicleague.com%2Fl%2Faaa%2Fbbb%2Fsubmit/1/0100019ef84fff5b-abc-000000/sig=473';
    expect(unwrapSesUrl(wrapped)).toBe('https://app.musicleague.com/l/aaa/bbb/submit');
  });

  it('returns non-SES urls unchanged', () => {
    expect(unwrapSesUrl('https://open.spotify.com/playlist/abc')).toBe('https://open.spotify.com/playlist/abc');
  });
});

// ---------------------------------------------------------------------------
// parseEmail — full parse of the three real lifecycle emails
// ---------------------------------------------------------------------------

describe('parseEmail — Round Starting', () => {
  it('extracts type, exact ml round id, round name, league, timestamp', async () => {
    const p = await parseEmail(fixture(ROUND_STARTING));
    expect(p.type).toBe('round_starting');
    expect(p.mlRoundId).toBe('12c30e07f33d4acd92ca489696788036');
    expect(p.roundName).toBe("EDM 'em");
    expect(p.leagueLabel).toContain('Fam Jam');
    expect(p.sentAt).toBe('2026-06-23T23:27:32.000Z');
    expect(p.fromAddr).toBe('notifications@musicleague.com');
    expect(p.playlistUrl).toBeNull();
  });
});

describe('parseEmail — The Votes Are In', () => {
  it('extracts type, exact ml round id, round name', async () => {
    const p = await parseEmail(fixture(VOTES_ARE_IN));
    expect(p.type).toBe('votes_are_in');
    expect(p.mlRoundId).toBe('1d4a94046a67405e9d855f5c0fd9136e');
    expect(p.roundName).toBe('Pick Me Up');
    expect(p.sentAt).toBe('2026-06-23T23:27:32.000Z');
  });
});

describe('parseEmail — New Playlist', () => {
  it('has no ml round id but extracts round name, league and playlist url', async () => {
    const p = await parseEmail(fixture(NEW_PLAYLIST));
    expect(p.type).toBe('new_playlist');
    expect(p.mlRoundId).toBeNull();
    expect(p.roundName).toBe('Plots so thicc');
    expect(p.leagueLabel).toContain('Hip Jammers');
    expect(p.playlistUrl).toContain('open.spotify.com/playlist/02J0ICSMkywokNYRhFxWCp');
    expect(p.sentAt).toBe('2026-06-22T15:00:54.000Z');
  });
});
