/**
 * Tests for triage.ts — groupFailures helper.
 */

import { describe, it, expect } from 'vitest';
import { groupFailures } from './triage.js';
import type { QueueFailure } from '$lib/db/metadataQueue.js';

function mkFailure(
  id: number,
  job_type: string,
  error: string | null,
  round_id: number | null = null,
  round_name: string | null = null
): QueueFailure {
  return { id, spotify_uri: `spotify:track:${id}`, job_type, error, retries: 1, round_id, round_name };
}

// ---------------------------------------------------------------------------
// groupFailures by='reason'
// ---------------------------------------------------------------------------

describe('groupFailures by reason', () => {
  it('groups rate_limited and transient failures into separate groups', () => {
    const failures: QueueFailure[] = [
      mkFailure(1, 'ytm', 'HTTP 429 rate limit exceeded'),
      mkFailure(2, 'lastfm_pop', 'HTTP 429 rate limit exceeded'),
      mkFailure(3, 'lyrics', 'Request timeout'),
    ];
    const groups = groupFailures(failures, 'reason');
    expect(groups.length).toBeGreaterThanOrEqual(2);

    const rl = groups.find(g => g.key === 'rate_limited');
    const tr = groups.find(g => g.key === 'transient');
    expect(rl).toBeDefined();
    expect(tr).toBeDefined();
    expect(rl!.ids.sort()).toEqual([1, 2]);
    expect(rl!.count).toBe(2);
    expect(tr!.ids).toEqual([3]);
    expect(tr!.count).toBe(1);
  });

  it('assigns correct labels, glyphs, tones, and why for each reason', () => {
    const failures: QueueFailure[] = [
      mkFailure(1, 'ytm', 'HTTP 429 rate limit'),            // rate_limited
      mkFailure(2, 'ytm', 'Track not found'),                 // no_data
      mkFailure(3, 'ytm', 'Request timeout'),                 // transient
      mkFailure(4, 'ytm', 'API key not configured'),          // config
    ];
    const groups = groupFailures(failures, 'reason');

    const rl = groups.find(g => g.key === 'rate_limited')!;
    expect(rl.label).toBe('Rate limited');
    expect(rl.glyph).toBe('⏱');
    expect(rl.tone).toBe('amber');
    expect(rl.why).toContain('rate limit');

    const nd = groups.find(g => g.key === 'no_data')!;
    expect(nd.label).toBe('No data');
    expect(nd.glyph).toBe('∅');
    expect(nd.tone).toBe('muted');

    const tr = groups.find(g => g.key === 'transient')!;
    expect(tr.label).toBe('Transient error');
    expect(tr.glyph).toBe('~');
    expect(tr.tone).toBe('sky');

    const cfg = groups.find(g => g.key === 'config')!;
    expect(cfg.label).toBe('Config error');
    expect(cfg.glyph).toBe('!');
    expect(cfg.tone).toBe('ember');
  });

  it('returns empty array for empty failures', () => {
    expect(groupFailures([], 'reason')).toEqual([]);
  });

  it('all ids in group have correct reason classification', () => {
    const failures: QueueFailure[] = [
      mkFailure(10, 'ytm', null),          // transient (null)
      mkFailure(11, 'ytm', null),          // transient
    ];
    const groups = groupFailures(failures, 'reason');
    const tr = groups.find(g => g.key === 'transient')!;
    expect(tr.ids.sort()).toEqual([10, 11]);
    expect(tr.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// groupFailures by='job'
// ---------------------------------------------------------------------------

describe('groupFailures by job', () => {
  it('buckets failures by job_type', () => {
    const failures: QueueFailure[] = [
      mkFailure(1, 'ytm', 'err'),
      mkFailure(2, 'ytm', 'err'),
      mkFailure(3, 'lastfm_pop', 'err'),
    ];
    const groups = groupFailures(failures, 'job');
    expect(groups.length).toBe(2);

    const ytm = groups.find(g => g.key === 'ytm')!;
    expect(ytm).toBeDefined();
    expect(ytm.ids.sort()).toEqual([1, 2]);
    expect(ytm.count).toBe(2);

    const lfm = groups.find(g => g.key === 'lastfm_pop')!;
    expect(lfm).toBeDefined();
    expect(lfm.count).toBe(1);
  });

  it('returns a group per unique job_type', () => {
    const failures: QueueFailure[] = [
      mkFailure(1, 'ytm', null),
      mkFailure(2, 'lastfm_pop', null),
      mkFailure(3, 'lastfm_tags', null),
      mkFailure(4, 'lyrics', null),
      mkFailure(5, 'audio', null),
    ];
    const groups = groupFailures(failures, 'job');
    expect(groups.length).toBe(5);
    const keys = groups.map(g => g.key).sort();
    expect(keys).toEqual(['audio', 'lastfm_pop', 'lastfm_tags', 'lyrics', 'ytm']);
  });
});

// ---------------------------------------------------------------------------
// groupFailures by='round'
// ---------------------------------------------------------------------------

describe('groupFailures by round', () => {
  it('groups failures by round_id into named groups', () => {
    const failures: QueueFailure[] = [
      mkFailure(1, 'ytm', 'err', 5, 'Round 5'),
      mkFailure(2, 'ytm', 'err', 5, 'Round 5'),
      mkFailure(3, 'ytm', 'err', 6, 'Round 6'),
    ];
    const groups = groupFailures(failures, 'round');
    expect(groups.length).toBe(2);

    const r5 = groups.find(g => g.key === 'round:5')!;
    expect(r5).toBeDefined();
    expect(r5.label).toBe('Round 5');
    expect(r5.ids.sort()).toEqual([1, 2]);
    expect(r5.count).toBe(2);

    const r6 = groups.find(g => g.key === 'round:6')!;
    expect(r6).toBeDefined();
    expect(r6.label).toBe('Round 6');
    expect(r6.count).toBe(1);
  });

  it('failures with null round_id go to unattributed group', () => {
    const failures: QueueFailure[] = [
      mkFailure(1, 'ytm', 'err', null, null),
      mkFailure(2, 'ytm', 'err', null, null),
      mkFailure(3, 'ytm', 'err', 7, 'Round 7'),
    ];
    const groups = groupFailures(failures, 'round');
    const unattr = groups.find(g => g.key === 'unattributed')!;
    expect(unattr).toBeDefined();
    expect(unattr.label).toMatch(/unattributed/i);
    expect(unattr.ids.sort()).toEqual([1, 2]);
    expect(unattr.count).toBe(2);
  });

  it('returns only unattributed group when all round_ids are null', () => {
    const failures: QueueFailure[] = [
      mkFailure(1, 'ytm', 'err', null, null),
    ];
    const groups = groupFailures(failures, 'round');
    expect(groups.length).toBe(1);
    expect(groups[0].key).toBe('unattributed');
  });
});
