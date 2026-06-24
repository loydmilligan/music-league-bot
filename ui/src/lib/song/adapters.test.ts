import { describe, it, expect } from 'vitest';
import { adapters, clamp05, rescale1to5 } from './adapters.js';
import { EMPTY_RATINGS } from './canonical.js';

describe('clamp05', () => {
  it('clamps to 0–5', () => {
    expect(clamp05(-1)).toBe(0);
    expect(clamp05(6)).toBe(5);
    expect(clamp05(3)).toBe(3);
  });
  it('passes null through', () => expect(clamp05(null)).toBeNull());
  it('passes undefined through', () => expect(clamp05(undefined)).toBeNull());
});

describe('rescale1to5', () => {
  it('maps 1→0, 3→~2-3, 5→5', () => {
    expect(rescale1to5(1)).toBe(0);
    expect(rescale1to5(5)).toBe(5);
    expect(rescale1to5(null)).toBeNull();
  });
});

describe('fromSpotify', () => {
  const raw = { id: 123, uri: 'spotify:track:abc', name: 'Song', artist: 'Artist', imageUrl: 'http://img' };
  const song = adapters.fromSpotify(raw as Record<string, unknown>);

  it('derives id from id field', () => expect(song.id).toBe('123'));
  it('sets spotifyUri from uri', () => expect(song.spotifyUri).toBe('spotify:track:abc'));
  it('sets art.url from imageUrl', () => expect(song.art?.url).toBe('http://img'));
  it('leaves ratings all null', () => expect(song.ratings).toEqual(EMPTY_RATINGS));
  it('sets title from name', () => expect(song.title).toBe('Song'));

  it('populates historyStatus when statusMap provided', () => {
    const s = adapters.fromSpotify(
      { spotifyUri: 'spotify:track:abc' } as Record<string, unknown>,
      { 'spotify:track:abc': 'song-mine' }
    );
    expect(s.context.historyStatus).toBe('song-mine');
  });

  it('historyStatus is null when not in map', () => {
    const s = adapters.fromSpotify(
      { spotifyUri: 'spotify:track:xyz' } as Record<string, unknown>,
      { 'spotify:track:abc': 'song-mine' }
    );
    expect(s.context.historyStatus).toBeNull();
  });
});

describe('fromShortlist — modern row (all 4 new fields present)', () => {
  const raw = {
    id: 'sl-1', spotifyUri: 'spotify:track:sl', title: 'SL Song', artist: 'A', albumArtUrl: 'http://art',
    ratingDiscovery: 4, ratingThemeFit: 3, ratingQuality: 5, ratingReplayability: 2,
    assignments: ['round-1'], submittedElsewhere: false,
  };
  const song = adapters.fromShortlist(raw as Record<string, unknown>);

  it('maps all 4 canonical rating fields', () => {
    expect(song.ratings.discovery).toBe(4);
    expect(song.ratings.themeFit).toBe(3);
    expect(song.ratings.quality).toBe(5);
    expect(song.ratings.replayability).toBe(2);
  });
  it('sets art.url from albumArtUrl', () => expect(song.art?.url).toBe('http://art'));
  it('populates assignments in context', () => expect(song.context.assignments).toEqual(['round-1']));
});

describe('fromShortlist — legacy row (no quality col, personal only)', () => {
  const raw = {
    id: 'sl-2', spotifyUri: 'spotify:track:sl2', title: 'Legacy', artist: 'B',
    ratingDiscovery: 3, ratingThemeFit: 2, ratingPersonal: 4, ratingQuality: null, ratingReplayability: null,
    coverUrl: 'http://cover',
  };
  const song = adapters.fromShortlist(raw as Record<string, unknown>);

  it('seeds quality from ratingPersonal when ratingQuality is null', () => {
    expect(song.ratings.quality).toBe(4);
  });
  it('replayability is null on legacy rows', () => expect(song.ratings.replayability).toBeNull());
  it('sets art.url from coverUrl', () => expect(song.art?.url).toBe('http://cover'));
});

describe('fromResearch', () => {
  const raw = {
    id: 99, spotifyUri: 'spotify:track:rr', title: 'RR Song', artist: 'C',
    discoveryPotential: 4, themeFit: 3, personalRating: 2, quality: null, replayability: null,
    saveForFuture: true, submittedByOther: 'Matt',
  };
  const song = adapters.fromResearch(raw as Record<string, unknown>);

  it('seeds quality from personalRating when quality is absent', () => {
    expect(song.ratings.quality).toBe(2);
  });
  it('sets saveForFuture in context', () => expect(song.context.saveForFuture).toBe(true));
  it('sets submittedByOther in context', () => expect(song.context.submittedByOther).toBe('Matt'));
  it('replayability null on legacy rows', () => expect(song.ratings.replayability).toBeNull());
});

describe('fromH2H', () => {
  it('rescales 1→0, 5→5', () => {
    const song = adapters.fromH2H({
      discoveryPotential: 1, themeFit: 5, personalRating: 3, replayability: null,
    } as Record<string, unknown>);
    expect(song.ratings.discovery).toBe(0);
    expect(song.ratings.themeFit).toBe(5);
  });
  it('uses quality field if present over personalRating', () => {
    const song = adapters.fromH2H({ quality: 4, personalRating: 2 } as Record<string, unknown>);
    expect(song.ratings.quality).toBe(rescale1to5(4));
  });
});

describe('fromChat', () => {
  const raw = {
    id: 'chat-1', spotifyUri: 'spotify:track:chat', title: 'Chat Song', artist: 'D',
    mentions: [
      { text: 'great song', sender: 'Matt', senderTone: 'sky', chatName: 'Group', tone: 'sky' },
    ],
    chatNames: ['Group'], intent: 'ALT', assignedRoundIds: ['r1'],
  };
  const song = adapters.fromChat(raw as Record<string, unknown>);

  it('sets mentionCount from mentions array length', () => {
    expect(song.context.chat?.mentionCount).toBe(1);
  });
  it('sets intent', () => expect(song.context.chat?.intent).toBe('ALT'));
  it('populates assignments', () => expect(song.context.assignments).toEqual(['r1']));
  it('ratings are all null', () => expect(song.ratings).toEqual(EMPTY_RATINGS));
});

describe('fromPodium', () => {
  const raw = { id: 'pod-1', title: 'Winner', artist: 'E', rank: 1, points: 42, submitter: 'Matt' };
  const song = adapters.fromPodium(raw as Record<string, unknown>);

  it('sets rank/points/submitter in context', () => {
    expect(song.context.rank).toBe(1);
    expect(song.context.points).toBe(42);
    expect(song.context.submitter).toBe('Matt');
  });
});

describe('art URL folding — all three spellings → art.url', () => {
  it('coverUrl', () => expect(adapters.fromShortlist({ coverUrl: 'http://cover' } as Record<string, unknown>).art?.url).toBe('http://cover'));
  it('albumArtUrl', () => expect(adapters.fromShortlist({ albumArtUrl: 'http://art' } as Record<string, unknown>).art?.url).toBe('http://art'));
  it('album_art_url', () => expect(adapters.fromShortlist({ album_art_url: 'http://art2' } as Record<string, unknown>).art?.url).toBe('http://art2'));
  it('imageUrl', () => expect(adapters.fromSpotify({ imageUrl: 'http://img' } as Record<string, unknown>).art?.url).toBe('http://img'));
  it('nested art.url', () => expect(adapters.fromSpotify({ art: { url: 'http://nested' } } as Record<string, unknown>).art?.url).toBe('http://nested'));
  it('null when no art field', () => expect(adapters.fromSpotify({} as Record<string, unknown>).art).toBeNull());
});
