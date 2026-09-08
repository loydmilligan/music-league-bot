import { describe, expect, it } from 'vitest';
import { buildVideoCoverHtml } from '../ui/src/lib/ytm/videoCover.js';
import type { VideoPick } from '../ui/src/lib/ytm/videoReview.js';

function pick(over: Partial<VideoPick>): VideoPick {
  return {
    title: 't', artists: 'a', spotifyUri: 'u', source: 'search', score: 80, band: 'auto',
    candidates: [], chosen: ['VID'], included: true, decided: true, reason: null, ...over,
  };
}
const base = { roundName: 'I Want My MTV', leagueTitle: 'Second Best' };
const T = ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'];

describe('video cover', () => {
  it('always fills all 16 cells, tiling what it has', () => {
    const html = buildVideoCoverHtml({ ...base, picks: [pick({}), pick({})] }, T, '');
    expect((html.match(/<img /g) ?? [])).toHaveLength(16);
  });

  it('falls back to solid cells rather than broken images when no thumb loaded', () => {
    const html = buildVideoCoverHtml({ ...base, picks: [pick({}), pick({})] }, [null, null], '');
    expect(html).not.toContain('<img ');
    expect((html.match(/mash-pulp-edge/g) ?? []).length).toBeGreaterThanOrEqual(16);
  });

  it('says the accuracy part out loud', () => {
    const html = buildVideoCoverHtml({ ...base, picks: [pick({})] }, T, '');
    expect(html).toContain('ACCURACY NOT GUARANTEED');
    expect(html).toContain('THE VIDEOS');
  });

  it('splits provenance so the picture states how many were guessed', () => {
    const mixed = [pick({ source: 'comment' }), pick({ source: 'search' }), pick({ source: 'search' })];
    expect(buildVideoCoverHtml({ ...base, picks: mixed }, T, '')).toContain('1 HAND-PICKED · 2 BEST GUESSES');
  });

  it('does not claim guesses when every pick came from a submitter', () => {
    const all = [pick({ source: 'comment' }), pick({ source: 'comment' })];
    const html = buildVideoCoverHtml({ ...base, picks: all }, T, '');
    expect(html).toContain('EVERY ONE HAND-PICKED');
    expect(html).not.toContain('BEST GUESS');
  });

  it('counts VIDEOS, not songs, when one song carries two', () => {
    const html = buildVideoCoverHtml(
      { ...base, picks: [pick({ source: 'comment', chosen: ['A', 'B'] }), pick({ source: 'search', chosen: ['C'] })] },
      T, '',
    );
    expect(html).toContain('3 VIDEOS');
    expect(html).toContain('2 HAND-PICKED · 1 BEST GUESS');
  });

  it('reads naturally for a single guessed video', () => {
    const html = buildVideoCoverHtml({ ...base, picks: [pick({ source: 'search' })] }, T, '');
    expect(html).toContain('1 VIDEO ·');
    expect(html).toContain('1 BEST GUESS');
    expect(html).not.toContain('BEST GUESSES');
  });

  it('escapes the round name instead of injecting markup', () => {
    const html = buildVideoCoverHtml({ ...base, roundName: '<script>x</script> & "co"', picks: [pick({})] }, T, '');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
