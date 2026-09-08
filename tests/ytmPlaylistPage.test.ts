import { describe, expect, it } from 'vitest';
import { buildPlaylistPageHtml, provenanceFor, rowsFor, watchAllUrl } from '../ui/src/lib/ytm/playlistPage.js';
import { bandStampSvg } from '../ui/src/lib/ytm/bandStamp.js';
import type { VideoPick } from '../ui/src/lib/ytm/videoReview.js';

function pick(over: Partial<VideoPick>): VideoPick {
  return {
    title: 'Song', artists: 'Artist', spotifyUri: 'u:1', source: 'search', score: 80, band: 'auto',
    candidates: [{ videoId: 'V1', title: 'Vid One', channel: 'Chan', score: 80 }],
    chosen: ['V1'], included: true, decided: true, reason: null, ...over,
  };
}
const twoVideos = pick({
  chosen: ['A', 'B'],
  candidates: [
    { videoId: 'A', title: 'the primary', channel: 'c', score: 90 },
    { videoId: 'B', title: 'the alternate', channel: 'd', score: 70 },
  ],
});
const base = { roundName: 'I Want My MTV', leagueTitle: 'Second Best', roundNumber: 143 };
const roster = [{ id: 'p1', name: 'Matt' }, { id: 'p2', name: 'Jon' }];

/** Every vote control on the page, primary or otherwise. */
const voteButtons = (html: string) => html.match(/class="vote /g) ?? [];

describe('rowsFor', () => {
  it('is one row per song, with chosen[0] leading and the rest as children', () => {
    const [row] = rowsFor([twoVideos]);
    expect(row.primary?.videoId).toBe('A');
    expect(row.children.map((c) => c.videoId)).toEqual(['B']);
  });

  it('keeps a song with no video, because that is a real answer', () => {
    const [row] = rowsFor([pick({ chosen: [], title: 'Where Is My Mind?' })]);
    expect(row.primary).toBeNull();
    expect(row.song).toBe('Where Is My Mind?');
  });

  it('survives a chosen id whose candidate has gone missing', () => {
    const [row] = rowsFor([pick({ chosen: ['GHOST'], candidates: [] })]);
    expect(row.primary).toEqual(expect.objectContaining({ videoId: 'GHOST', videoTitle: 'Song' }));
  });
});

describe('provenanceFor (D4)', () => {
  const entry = (over: Partial<{ score: number; manual: boolean }>) =>
    ({ videoId: 'V1', videoTitle: 't', channel: null, score: 80, manual: false, ...over });

  it('says words, at the score boundaries the spec sets', () => {
    const p = pick({ source: 'search' });
    expect(provenanceFor(p, entry({ score: 70 }))).toBe('WE FOUND THIS');
    expect(provenanceFor(p, entry({ score: 69 }))).toBe('BEST GUESS');
    expect(provenanceFor(p, entry({ score: 45 }))).toBe('BEST GUESS');
    expect(provenanceFor(p, entry({ score: 44 }))).toBe('A GUESS');
    expect(provenanceFor(pick({ source: 'comment' }), entry({ score: 10 }))).toBe('THEIR PICK');
  });

  it('calls a hand-pasted link what it is, whatever the song’s source was', () => {
    // `manual` is a fact about this video; `source` describes how the song was
    // hunted for. Reading source first would credit search for Matt's typing.
    expect(provenanceFor(pick({ source: 'comment' }), entry({ manual: true }))).toBe('ADDED BY HAND');
    expect(provenanceFor(pick({ source: 'search' }), entry({ manual: true }))).toBe('ADDED BY HAND');
  });

  it('falls back to the pick score when there is no candidate at all', () => {
    expect(provenanceFor(pick({ score: 20, chosen: [] }), null)).toBe('A GUESS');
  });
});

describe('watchAllUrl', () => {
  it('builds a temporary-playlist link needing no playlist to exist', () => {
    expect(watchAllUrl(['A', 'B'])).toBe('https://www.youtube.com/watch_videos?video_ids=A,B');
  });

  it('titles the playlist, so it is not "Untitled List"', () => {
    const url = watchAllUrl(['A', 'B'], 'Second Best · Captain Jack Sparrow')!;
    expect(url).toContain('title=Second+Best+%C2%B7+Captain+Jack+Sparrow');
  });

  it('leaves the id separators as literal commas', () => {
    // YouTube does not split on percent-encoded commas, so encoding them
    // silently reduces the playlist to a single video.
    const url = watchAllUrl(['AAA', 'BBB', 'CCC'], 'x')!;
    expect(url).toContain('video_ids=AAA,BBB,CCC');
    expect(url).not.toContain('%2C');
  });
  it('caps at the 50 YouTube accepts', () => {
    const url = watchAllUrl(Array.from({ length: 80 }, (_, i) => `V${i}`))!;
    expect(url.split(',')).toHaveLength(50);
  });
  it('is absent when there is nothing to play', () => {
    expect(watchAllUrl([])).toBeNull();
  });
});

describe('page html', () => {
  it('carries the round name and every video into the play-all link', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [twoVideos] });
    expect(html).toContain('video_ids=A,B');
    expect(html).toContain('title=Second+Best');
    expect(html).toContain('I+Want+My+MTV');
  });

  it('labels the tape with the league and round number', () => {
    expect(buildPlaylistPageHtml({ ...base, picks: [pick({})] })).toContain('Second Best · R143');
    const noNumber = buildPlaylistPageHtml({ ...base, roundNumber: null, picks: [pick({})] });
    expect(noNumber).toContain('>Second Best<');
    expect(noNumber).not.toContain('· R');
  });

  it('shows the provenance words and never the raw score', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [
      pick({ source: 'comment' }),
      pick({ spotifyUri: 'u:2', score: 50, candidates: [{ videoId: 'V2', title: 'v', channel: null, score: 50 }], chosen: ['V2'] }),
    ] });
    expect(html).toContain('THEIR PICK');
    expect(html).toContain('BEST GUESS');
    // The raw score is admin-only, so no chip may carry a number.
    const chips = [...html.matchAll(/class="prov"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(chips).toEqual(['THEIR PICK', 'BEST GUESS']);
  });

  it('votes only on the primary; children are collapsed and voteless', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [twoVideos] });
    expect(voteButtons(html)).toHaveLength(2); // up + down, for A alone
    expect(html).toContain('data-v="A" data-dir="up"');
    expect(html).not.toContain('data-v="B" data-dir');
    // Collapsed = a <details> with no `open`, so B is present but not on show.
    expect(html).toMatch(/<details class="kids">/);
    expect(html).toContain('+1 more video for this song');
    expect(html).toContain('the alternate');
  });

  it('suppresses the accuracy footnote when nothing was guessed', () => {
    const allHuman = buildPlaylistPageHtml({ ...base, picks: [pick({ source: 'comment' }), pick({ spotifyUri: 'u:2', source: 'comment' })] });
    expect(allHuman).not.toContain('A machine guessed');
    const mixed = buildPlaylistPageHtml({ ...base, picks: [pick({ source: 'comment' }), pick({ spotifyUri: 'u:2' })] });
    expect(mixed).toContain('A machine guessed at the 1 without a link');
  });

  it('renders the band stamp for the primary’s stampers only', () => {
    const html = buildPlaylistPageHtml({
      ...base,
      picks: [twoVideos, pick({ spotifyUri: 'u:2' })],
      tallies: [
        { videoId: 'A', up: 3, down: 0, stampers: ['matt', 'tj'] },
        { videoId: 'V1', up: 1, down: 0, stampers: [] },
      ],
    });
    expect(html).toContain(bandStampSvg(['matt', 'tj'], { size: 46 }));
    expect(html).not.toContain(bandStampSvg(['matt'], { size: 46 }));
    expect((html.match(/class="stamp"/g) ?? [])).toHaveLength(1);
  });

  it('shows the tallies it was given', () => {
    const html = buildPlaylistPageHtml({
      ...base, picks: [pick({})],
      tallies: [{ videoId: 'V1', up: 7, down: 2, stampers: [] }],
    });
    expect(html).toContain('<span class="n">7</span>');
    expect(html).toContain('<span class="n">2</span>');
  });

  it('handles a song with no video and offers it no controls', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [pick({ chosen: [] })] });
    expect(html).toContain('No video for this one');
    expect(voteButtons(html)).toHaveLength(0);
    expect(html).not.toContain('class="say"');
  });

  it('has an empty state instead of an empty list', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [] });
    expect(html).toContain('No videos for this round.');
    expect(html).not.toContain('PLAY ALL');
    expect(voteButtons(html)).toHaveLength(0);
  });

  it('gives votes and SAY a 44px target, which the prototype chips did not', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [pick({})] });
    expect(html).toMatch(/\.vote,\.say\{[^}]*min-height:44px/);
    expect(html).toMatch(/\.vote,\.say\{[^}]*min-width:44px/);
  });

  it('never gates the list behind identity', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [pick({ title: 'Sabotage' })], roster });
    expect(html).toContain('Sabotage');
    expect(html).toContain('<dialog id="roster">');
    // An `open` dialog would be the gate D2 explicitly rejected.
    expect(html).not.toMatch(/<dialog id="roster" open/);
    expect(html).toContain('data-id="p2" data-name="Jon"');
  });

  it('posts to the configured api base', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [pick({})], slug: 'abc' });
    expect(html).toContain('var API = "/api/p"');
    expect(html).toContain('var SLUG = "abc"');
    const moved = buildPlaylistPageHtml({ ...base, picks: [pick({})], apiBase: '/w/p' });
    expect(moved).toContain('var API = "/w/p"');
    expect(moved).not.toContain('/api/p');
  });

  it('escapes titles instead of letting them become markup', () => {
    const html = buildPlaylistPageHtml({ ...base, roundName: '<img src=x onerror=alert(1)>', picks: [pick({})] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('escapes a roster name into the script’s string literals too', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [pick({})], slug: '</script><b>' });
    expect(html).not.toContain('</script><b>');
  });

  it('is self-contained: no build-step assets beyond the shared fonts', () => {
    const html = buildPlaylistPageHtml({ ...base, picks: [pick({})], roster });
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect((html.match(/<link[^>]+stylesheet/g) ?? [])).toHaveLength(1);
    // Thumbnails are the one other origin the page is allowed to reach.
    const origins = new Set((html.match(/https?:\/\/[a-z0-9.-]+/g) ?? []));
    expect([...origins]).toEqual(['https://www.youtube.com', 'https://i.ytimg.com', 'https://www.youtube-nocookie.com']);
  });

  it('does not autoload a player per video', () => {
    const many = Array.from({ length: 12 }, (_, i) => pick({ spotifyUri: `u:${i}` }));
    const html = buildPlaylistPageHtml({ ...base, picks: many });
    expect(html).not.toContain('<iframe');
  });
});
