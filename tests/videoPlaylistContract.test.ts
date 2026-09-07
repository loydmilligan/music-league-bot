import { describe, expect, it } from 'vitest';
import * as ts from '../ui/src/lib/db/videoPlaylist.js';
// @ts-expect-error — plain .mjs twin, no types
import * as mjs from '../scripts/ytm-drop/videoConfig.mjs';

/**
 * The config contract is implemented twice (see the header of either module).
 * These cases exist so the copies cannot drift apart silently — every case runs
 * through BOTH and the results must be identical.
 */
const CASES: Array<[string, string | null, string | null]> = [
  ['both null → shipped defaults', null, null],
  ['round inherits defaults', null, '{"enabled":true,"useComments":false,"useSearch":true,"searchAutoAcceptPct":55}'],
  ['round overrides one field', '{"enabled":true}', '{"enabled":false,"searchAutoAcceptPct":40}'],
  ['round fully overrides', '{"enabled":true,"useComments":false,"useSearch":true,"searchAutoAcceptPct":90}', null],
  ['round turns it off against an on default', '{"enabled":false}', '{"enabled":true}'],
  ['empty object is an override, not an inherit', '{}', '{"enabled":true,"searchAutoAcceptPct":33}'],
  ['malformed round json falls back to defaults', '{not json', '{"enabled":true}'],
  ['malformed defaults json falls back to shipped', null, 'nonsense'],
  ['empty string is treated as absent', '', ''],
  ['pct above range clamps to 100', '{"searchAutoAcceptPct":250}', null],
  ['pct below range clamps to 0', '{"searchAutoAcceptPct":-13}', null],
  ['pct as a numeric string is accepted', '{"searchAutoAcceptPct":"64"}', null],
  ['fractional pct rounds', '{"searchAutoAcceptPct":71.6}', null],
  ['non-numeric pct falls back, not to zero', '{"searchAutoAcceptPct":"banana"}', '{"searchAutoAcceptPct":80}'],
  ['non-boolean flag falls back', '{"enabled":"yes"}', '{"enabled":true}'],
  ['a JSON array is not a config', '[1,2,3]', '{"enabled":true}'],
  ['JSON null round means inherit', 'null', '{"enabled":true,"useSearch":false}'],
];

describe('video playlist config — the two implementations agree', () => {
  for (const [label, roundJson, defaultsJson] of CASES) {
    it(label, () => {
      const a = ts.resolveVideoPlaylistConfig(roundJson, defaultsJson);
      const b = mjs.resolveVideoPlaylistConfig(roundJson, defaultsJson);
      expect(b).toEqual(a);
      // Pin the shape too, so "both are equally wrong" still fails.
      expect(Object.keys(a).sort()).toEqual(['enabled', 'searchAutoAcceptPct', 'useComments', 'useSearch']);
      expect(typeof a.enabled).toBe('boolean');
      expect(Number.isInteger(a.searchAutoAcceptPct)).toBe(true);
      expect(a.searchAutoAcceptPct).toBeGreaterThanOrEqual(0);
      expect(a.searchAutoAcceptPct).toBeLessThanOrEqual(100);
    });
  }

  it('ships the same defaults on both sides', () => {
    expect(mjs.DEFAULT_VIDEO_PLAYLIST_CONFIG).toEqual(ts.DEFAULT_VIDEO_PLAYLIST_CONFIG);
    expect(mjs.VIDEO_PLAYLIST_DEFAULTS_KEY).toBe(ts.VIDEO_PLAYLIST_DEFAULTS_KEY);
  });

  it('agrees on the no-source case', () => {
    const cfg = { enabled: true, useComments: false, useSearch: false, searchAutoAcceptPct: 70 };
    expect(mjs.hasNoVideoSource(cfg)).toBe(true);
    expect(ts.hasNoVideoSource(cfg)).toBe(true);
    expect(ts.hasNoVideoSource({ ...cfg, enabled: false })).toBe(false);
  });
});

describe('resolveVideoPlaylistConfig — inheritance semantics', () => {
  it('a round with no stored config follows later default changes', () => {
    expect(ts.resolveVideoPlaylistConfig(null, '{"enabled":true,"searchAutoAcceptPct":85}')).toEqual({
      enabled: true, useComments: true, useSearch: true, searchAutoAcceptPct: 85,
    });
  });

  it('a stored override survives a default change to the same field', () => {
    expect(ts.resolveVideoPlaylistConfig('{"searchAutoAcceptPct":50}', '{"searchAutoAcceptPct":85}').searchAutoAcceptPct).toBe(50);
  });
});
