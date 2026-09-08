import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error — plain .mjs module, no types
import { extractVideoIds, channelMatchesArtist, resolveVideoPicks, scoreSearchHit, undecidedPicks } from '../scripts/ytm-drop/videos.mjs';

describe('extractVideoIds', () => {
  it('reads the three link shapes people actually paste', () => {
    expect(extractVideoIds('https://youtu.be/RGE-JRsJ2uo?is=VPZYfmps5qPaxxNK')).toEqual(['RGE-JRsJ2uo']);
    expect(extractVideoIds('https://www.youtube.com/watch?v=Orlbo9WkZ2E&t=30s')).toEqual(['Orlbo9WkZ2E']);
    expect(extractVideoIds('https://m.youtube.com/shorts/kEqGdGAgAjw')).toEqual(['kEqGdGAgAjw']);
  });

  it('returns links in the order they appear, not in pattern order', () => {
    // The caller takes [0] as "the link the submitter meant". Both ids are
    // present either way, so only the ORDER can catch a pattern-major scan.
    const comment = 'watch https://youtu.be/TZ827lkktYs — or the long one https://www.youtube.com/watch?v=Orlbo9WkZ2E';
    expect(extractVideoIds(comment)[0]).toBe('TZ827lkktYs');
  });

  it('is quiet on comments with no video and on no comment at all', () => {
    expect(extractVideoIds('The video with the baby always makes me laugh')).toEqual([]);
    expect(extractVideoIds(null)).toEqual([]);
    expect(extractVideoIds('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC')).toEqual([]);
  });
});

describe('channelMatchesArtist', () => {
  it('accepts the artist channel and its VEVO/Official/Topic variants', () => {
    expect(channelMatchesArtist('LeonBridgesVEVO', 'Leon Bridges')).toBe(true);
    expect(channelMatchesArtist('PixiesOfficial', 'Pixies')).toBe(true);
    expect(channelMatchesArtist('Flight Of The Conchords - Topic', 'Flight of the Conchords, Jemaine Clement')).toBe(true);
  });

  it('rejects the covers and fan uploads search actually returned', () => {
    expect(channelMatchesArtist('The Wellermen', 'Stan Rogers')).toBe(false);
    expect(channelMatchesArtist('IslamicVideo Daily', 'Serengeti')).toBe(false);
    expect(channelMatchesArtist('building55', 'Josh Ritter')).toBe(false);
  });

  it('does not match on a missing channel or artist', () => {
    expect(channelMatchesArtist(null, 'Pixies')).toBe(false);
    expect(channelMatchesArtist('PixiesOfficial', '')).toBe(false);
  });
});

describe('scoreSearchHit', () => {
  const t = (title: string, artists: string) => ({ title, artists });

  it('scores the real SB R141 results the way the threshold needs', () => {
    // These five are verbatim from the live dry run; the recommended 70 has to
    // split them 2/3 or the default is wrong.
    expect(scoreSearchHit({ channel: 'PixiesOfficial', title: 'Pixies - Where Is My Mind (Official Video)' }, t('Where Is My Mind?', 'Pixies'), 0)).toBe(100);
    expect(scoreSearchHit({ channel: 'LeonBridgesVEVO', title: "Leon Bridges - Smooth Sailin'" }, t("Smooth Sailin'", 'Leon Bridges'), 0)).toBe(75);
    expect(scoreSearchHit({ channel: 'The Wellermen', title: "Barrett's Privateers" }, t("Barrett's Privateers", 'Stan Rogers'), 0)).toBe(30);
    expect(scoreSearchHit({ channel: 'building55', title: 'Josh Ritter - Another New World' }, t('Another New World', 'Josh Ritter'), 0)).toBe(30);
    expect(scoreSearchHit({ channel: 'IslamicVideo Daily', title: 'Shark Attack Compilation' }, t('shark attack', 'Serengeti'), 2)).toBe(20);
  });

  it('will not auto-accept an artist-channel upload of the WRONG song at 70', () => {
    // Artist channel (45) + rank (10) = 55. The title check is what stops a
    // drift to a different track on the right channel from sailing through.
    expect(scoreSearchHit({ channel: 'PixiesOfficial', title: 'Pixies - Debaser' }, t('Where Is My Mind?', 'Pixies'), 0)).toBe(55);
  });

  it('demotes a lyric video below the real one but keeps it above the also-rans', () => {
    // The real R141 candidate list for "Where Is My Mind?", rank held constant.
    // Before the penalty the lyric video scored 70 and was auto-accepted over
    // the actual music video; the ordering below is the whole point of it.
    const track = t('Where Is My Mind?', 'Pixies');
    const real = scoreSearchHit({ channel: 'Moisés, Mara, Simão e', title: 'Pixies   Where Is My Mind Official Video' }, track, 0);
    const lyric = scoreSearchHit({ channel: 'PixiesOfficial', title: 'Pixies - Where Is My Mind? (Official Lyric Video)' }, track, 0);
    const fan = scoreSearchHit({ channel: "i'm cyborg but that's ok", title: 'Pixies - Where Is My Mind' }, track, 0);
    expect(real).toBeGreaterThan(lyric);
    expect(lyric).toBeGreaterThan(fan);
    // And it must no longer clear the recommended auto-accept line on its own.
    expect(lyric).toBeLessThan(70);
  });

  it('keeps a lyric video ahead of a cover, a reaction and karaoke', () => {
    const track = t("Barrett's Privateers", 'Stan Rogers');
    const lyric = scoreSearchHit({ channel: 'Stan Rogers', title: "Barrett's Privateers (Lyric Video)" }, track, 0);
    for (const wrong of [
      { channel: 'Shanty Folk', title: "Barrett's Privateers (cover)" },
      { channel: 'Some Guy', title: "Barrett's Privateers cover by Some Guy" },
      { channel: 'Reactions', title: "Barrett's Privateers REACTION" },
      { channel: 'SingAlong', title: "Barrett's Privateers karaoke" },
      { channel: 'Chat', title: "Barrett's Privateers - commentary and breakdown" },
    ]) {
      expect(lyric).toBeGreaterThan(scoreSearchHit(wrong, track, 0));
    }
  });

  it('outranks a cover even when the cover is the better-labelled upload', () => {
    // The discriminating case: this cover carries "Official Video" AND the track
    // name, so on the bonuses alone it beats a lyric video on the artist's own
    // channel. Only the wrong-artefact penalty puts it back where it belongs.
    const track = t("Barrett's Privateers", 'Stan Rogers');
    const lyric = scoreSearchHit({ channel: 'Stan Rogers', title: "Barrett's Privateers (Lyric Video)" }, track, 0);
    const slickCover = scoreSearchHit(
      { channel: 'Shanty Folk', title: "Barrett's Privateers (Official Video) - cover by Shanty Folk" }, track, 0);
    expect(slickCover).toBeLessThan(lyric);
  });

  it('does not punish a song whose own title contains "cover"', () => {
    // \bcover\b alone would gut this; the penalty needs an annotative phrasing.
    const track = t('Cover Me', 'Bruce Springsteen');
    const legit = scoreSearchHit({ channel: 'BruceSpringsteenVEVO', title: 'Bruce Springsteen - Cover Me (Official Video)' }, track, 0);
    expect(legit).toBe(100);
  });

  it('never returns a negative score', () => {
    const track = t('x', 'y');
    expect(scoreSearchHit({ channel: 'nope', title: 'x karaoke lyrics reaction cover by someone' }, track, 5)).toBe(0);
  });

  it('scores a missing hit as zero rather than throwing', () => {
    expect(scoreSearchHit(null, t('x', 'y'), 0)).toBe(0);
  });
});

describe('resolveVideoPicks', () => {
  const subs = [
    { title: 'Au Pays du Cocaine', artists: 'Geese', spotifyUri: 'u:1', comment: 'https://youtu.be/RGE-JRsJ2uo\n\nthe baby one' },
    { title: 'Smooth Sailin', artists: 'Leon Bridges', spotifyUri: 'u:2', comment: 'no link here' },
    { title: "Barrett's Privateers", artists: 'Stan Rogers', spotifyUri: 'u:3', comment: null },
  ];
  // Every song has search results, so a comment pick is distinguishable only by
  // NOT being the search id. The two searched songs land on opposite sides of
  // the default auto-accept line, and the third band is reachable too.
  const ytSearch = vi.fn(async (q: string) => {
    if (q.startsWith('Au Pays')) return [{ videoId: 'SEARCHHIT01', title: 'Au Pays', channel: 'Some Rando' }];
    if (q.startsWith('Smooth')) return [
      { videoId: 'HYplnRjMVhM', title: 'Leon Bridges - Smooth Sailin', channel: 'LeonBridgesVEVO' },
      { videoId: 'ALT2', title: 'Smooth Sailin live', channel: 'Bootlegs' },
    ];
    return [
      { videoId: '1WDX4PAH1L0', title: "Barrett's Privateers", channel: 'The Wellermen' },
      { videoId: 'ALT3', title: 'Barrett Privateers sea shanty', channel: 'Shanty Hub' },
    ];
  });

  it('prefers the submitter link and never searches for that song', async () => {
    ytSearch.mockClear();
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0 });
    expect(picks[0]).toMatchObject({ band: 'certain', source: 'comment', chosen: ['RGE-JRsJ2uo'], included: true, decided: true });
    expect(ytSearch).toHaveBeenCalledTimes(2);
    expect(ytSearch.mock.calls.some((c) => String(c[0]).startsWith('Au Pays'))).toBe(false);
  });

  it('bands a strong hit auto (included) and a weak one suggestion (excluded)', async () => {
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, autoAcceptPct: 70, hilPct: 40 });
    expect(picks[1]).toMatchObject({ band: 'auto', chosen: ['HYplnRjMVhM'], included: true, decided: true });
    // 30 < hilPct 40 → a long shot: nothing preselected, nothing included.
    expect(picks[2]).toMatchObject({ band: 'suggestion', chosen: [], included: false, decided: true });
  });

  it('bands the middle as review — preselected but NOT decided, and not included', async () => {
    // hil 25 / auto 70 puts the 30-scoring Wellermen hit in the review band.
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, autoAcceptPct: 70, hilPct: 25 });
    expect(picks[2]).toMatchObject({ band: 'review', chosen: ['1WDX4PAH1L0'], included: false, decided: false });
    expect(undecidedPicks(picks)).toHaveLength(1);
  });

  it('offers alternatives, best first, capped', async () => {
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0 });
    const c = picks[2].candidates;
    expect(c.length).toBeGreaterThan(1);
    expect(c[0].score).toBeGreaterThanOrEqual(c[1].score);
    expect(c.map((x: { videoId: string }) => x.videoId)).toContain('ALT3');
    const capped = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, candidateLimit: 1 });
    expect(capped[2].candidates).toHaveLength(1);
  });

  it('a comment pick carries a single candidate so the UI has something to show', async () => {
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0 });
    expect(picks[0].candidates).toEqual([{ videoId: 'RGE-JRsJ2uo', title: 'Au Pays du Cocaine', channel: null, score: 100 }]);
  });

  it('useComments:false ignores the submitter link and searches instead', async () => {
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, useComments: false });
    // The submitter's link is gone; what search found takes its place. That hit
    // scores 10 (nothing but the rank bonus), so it lands as an unselected long
    // shot rather than quietly replacing the link the submitter chose.
    expect(picks[0].source).toBe('search');
    expect(picks[0].band).toBe('suggestion');
    expect(picks[0].chosen).toEqual([]);
    expect(picks[0].candidates.map((c: { videoId: string }) => c.videoId)).toEqual(['SEARCHHIT01']);
    expect(picks[0].candidates.map((c: { videoId: string }) => c.videoId)).not.toContain('RGE-JRsJ2uo');
  });

  it('useSearch:false leaves the gaps empty and never calls search', async () => {
    const spy = vi.fn(async () => [{ videoId: 'X', title: 't', channel: 'c' }]);
    const picks = await resolveVideoPicks(subs, spy, { pacingMs: 0, useSearch: false });
    expect(picks[0].chosen).toEqual(['RGE-JRsJ2uo']);
    expect(picks[1]).toMatchObject({ chosen: [], included: false, decided: true });
    expect(picks[1].reason).toContain('search is off');
    expect(spy).not.toHaveBeenCalled();
  });

  it('never leaves a hole undecided — an empty result must not block approval', async () => {
    const picks = await resolveVideoPicks([subs[2]], async () => [], { pacingMs: 0 });
    expect(picks[0]).toMatchObject({ chosen: [], included: false, decided: true, reason: 'search found nothing' });
    expect(undecidedPicks(picks)).toHaveLength(0);
  });

  it('keeps going when one search throws, and that hole does not block either', async () => {
    const boom = vi.fn(async (q: string) => {
      if (q.startsWith('Smooth')) throw new Error('search HTTP 429');
      return [{ videoId: 'OK1', title: "Barrett's Privateers (Official Video)", channel: 'Stan Rogers' }];
    });
    const picks = await resolveVideoPicks(subs, boom, { pacingMs: 0 });
    expect(picks[1]).toMatchObject({ chosen: [], decided: true });
    expect(picks[1].reason).toContain('429');
    expect(picks[2].chosen).toEqual(['OK1']);
    expect(undecidedPicks(picks)).toHaveLength(0);
  });

  it('returns one entry per submission even when everything fails', async () => {
    const picks = await resolveVideoPicks(subs, async () => { throw new Error('down'); }, { pacingMs: 0 });
    expect(picks).toHaveLength(subs.length);
  });

  it('an inverted threshold pair cannot create an empty review band', async () => {
    // hilPct above autoAcceptPct is clamped, so nothing falls through the gap.
    const picks = await resolveVideoPicks(subs, ytSearch, { pacingMs: 0, autoAcceptPct: 50, hilPct: 90 });
    for (const p of picks) expect(['certain', 'auto', 'suggestion']).toContain(p.band);
  });
});
