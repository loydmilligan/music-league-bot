import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as rateLimiterModule from '../src/resolver/songlinkRateLimiter.js';
import type Database from 'better-sqlite3';
import { openDb } from '../src/storage/db.js';
import { handleMessage, type WhatsAppMessage, type BotConfig } from '../src/bot/handler.js';
import { rulesConfigSchema } from '../src/config/types.js';
import type { ISpotifyAdapter } from '../src/music/types.js';
import { memoryCmuPreview } from '../src/bot/cmuPreview.js';
import { createPromptTables, insertPrompt } from '../src/chat/prompts/store.js';

// A real track for use in tests
const sampleTrack = {
  title: 'No Ordinary Love',
  artist: 'Sade',
  album: 'Love Deluxe',
  durationMs: 290000,
  spotifyTrackId: 'abc123',
  spotifyUri: 'spotify:track:abc123',
  sourceUrl: 'https://open.spotify.com/track/abc123',
  confidence: 1.0,
};

// A minimal valid config
const testConfig = rulesConfigSchema.parse({
  defaults: { requireCommandPrefix: true, commandPrefix: '!song' },
  rules: [{
    name: 'Test Playlist',
    enabled: true,
    when: { command: 'song' },
    playlist: { spotify: 'Test Playlist' },
  }],
  notifications: {
    onFailure: true,
    onLowConfidence: true,
    confidenceThreshold: 0.9,
    recipients: 'me',
    successReply: 'simple',
  },
});

function makeMockMsg(body: string, opts: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  return {
    body,
    from: 'BmCQHGE3k0a0ST5ZDPFmqW@g.us',
    chatName: 'Test Group',
    author: '16171234567@c.us',
    fromMe: false,
    capturedAt: '2026-01-01T00:00:00.000Z',
    priorMessages: [],
    reply: vi.fn().mockResolvedValue(undefined),
    getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
    ...opts,
  };
}

function makeMockSpotify(overrides: Partial<ISpotifyAdapter> = {}): ISpotifyAdapter {
  return {
    searchTrack: vi.fn().mockResolvedValue(sampleTrack),
    getTrackById: vi.fn().mockResolvedValue(sampleTrack),
    findOrCreatePlaylist: vi.fn().mockResolvedValue('playlist-id-123'),
    isTrackInPlaylist: vi.fn().mockResolvedValue(false),
    addTrackToPlaylist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeBotConfig(overrides: Partial<BotConfig> = {}, dbInst?: Database.Database): BotConfig {
  return {
    config: testConfig,
    spotify: makeMockSpotify(),
    db: dbInst ?? openDb(':memory:'),
    allowedGroupIds: ['BmCQHGE3k0a0ST5ZDPFmqW'],
    ownerPhone: '16617476822@c.us',
    masterPlaylistName: 'Test Master Playlist',
    sendDm: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test 1: Ignores non-allowed group
  it('ignores messages not from an allowed group', async () => {
    const msg = makeMockMsg('!song Sade - No Ordinary Love', {
      from: 'OTHER@g.us',
    });
    const spotify = makeMockSpotify();
    const botConfig = makeBotConfig({ spotify });

    await handleMessage(msg, botConfig);

    expect(spotify.searchTrack).not.toHaveBeenCalled();
    expect(spotify.getTrackById).not.toHaveBeenCalled();
  });

  // Test 2: Processes fromMe messages (user IS the bot — same account scanned QR)
  it('processes !song messages sent by the bot account (fromMe)', async () => {
    const msg = makeMockMsg('!song Sade - No Ordinary Love', {
      fromMe: true,
    });
    const spotify = makeMockSpotify();
    const botConfig = makeBotConfig({ spotify });

    await handleMessage(msg, botConfig);

    expect(spotify.searchTrack).toHaveBeenCalled();
  });

  // Test 3: Ignores non-song messages
  it('ignores non-song messages', async () => {
    const msg = makeMockMsg('hello world');
    const spotify = makeMockSpotify();
    const botConfig = makeBotConfig({ spotify });

    await handleMessage(msg, botConfig);

    expect(spotify.searchTrack).not.toHaveBeenCalled();
    expect(spotify.getTrackById).not.toHaveBeenCalled();
  });

  // Test 4: Not-found: sends DM when onFailure=true
  it('sends DM when track not found and onFailure=true', async () => {
    const db = openDb(':memory:');
    const spotify = makeMockSpotify({
      searchTrack: vi.fn().mockResolvedValue(null),
      getTrackById: vi.fn().mockResolvedValue(null),
    });
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const botConfig = makeBotConfig({ spotify, sendDm }, db);

    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    await handleMessage(msg, botConfig);

    expect(sendDm).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('❌'),
    );
    expect(spotify.addTrackToPlaylist).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM submissions').all() as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('not-found');
  });

  // Test 5: Not-found: no DM when onFailure=false
  it('does not send DM when track not found and onFailure=false', async () => {
    const configWithNoFailureNotif = rulesConfigSchema.parse({
      defaults: {},
      rules: [{
        name: 'Test Playlist',
        enabled: true,
        when: { command: 'song' },
        playlist: { spotify: 'Test Playlist' },
      }],
      notifications: {
        onFailure: false,
        onLowConfidence: false,
        confidenceThreshold: 0.9,
        recipients: 'me',
        successReply: 'simple',
      },
    });

    const spotify = makeMockSpotify({
      searchTrack: vi.fn().mockResolvedValue(null),
      getTrackById: vi.fn().mockResolvedValue(null),
    });
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const botConfig = makeBotConfig({ config: configWithNoFailureNotif, spotify, sendDm });

    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    await handleMessage(msg, botConfig);

    expect(sendDm).not.toHaveBeenCalled();
  });

  // Test 6: Low-confidence: notifies and still adds
  it('notifies on low-confidence and still adds the track', async () => {
    const db = openDb(':memory:');
    const lowConfTrack = { ...sampleTrack, confidence: 0.5 };
    const spotify = makeMockSpotify({
      searchTrack: vi.fn().mockResolvedValue(lowConfTrack),
    });
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const botConfig = makeBotConfig({ spotify, sendDm }, db);

    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    await handleMessage(msg, botConfig);

    expect(sendDm).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('⚠️'),
    );
    expect(spotify.addTrackToPlaylist).toHaveBeenCalled();
  });

  // Test 7: No matching rule: inserts no-rule, no reply
  it('inserts no-rule status when no rules match, and does not reply', async () => {
    const db = openDb(':memory:');
    const emptyRulesConfig = rulesConfigSchema.parse({
      defaults: {},
      rules: [],
    });

    const spotify = makeMockSpotify();
    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    const botConfig = makeBotConfig({ config: emptyRulesConfig, spotify }, db);

    await handleMessage(msg, botConfig);

    expect(msg.reply).not.toHaveBeenCalled();
    const rows = db.prepare('SELECT * FROM submissions').all() as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('no-rule');
  });

  // Test 8: Duplicate: replies with ⚠️, inserts duplicate
  it('handles duplicate track — replies with warning, inserts duplicate status', async () => {
    const db = openDb(':memory:');
    const spotify = makeMockSpotify({
      isTrackInPlaylist: vi.fn().mockResolvedValue(true),
    });
    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    const botConfig = makeBotConfig({ spotify }, db);

    await handleMessage(msg, botConfig);

    expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('⚠️'));
    expect(spotify.addTrackToPlaylist).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM submissions').all() as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('duplicate');
  });

  // Test 9: Success simple: adds track, simple reply, inserts added
  it('adds track successfully with simple reply and inserts added status', async () => {
    const db = openDb(':memory:');
    const spotify = makeMockSpotify();
    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    const botConfig = makeBotConfig({ spotify }, db);

    await handleMessage(msg, botConfig);

    expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('✅ Added'));
    expect(msg.reply).not.toHaveBeenCalledWith(expect.stringContaining('Love Deluxe'));

    const rows = db.prepare('SELECT * FROM submissions').all() as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('added');
  });

  // Test 10: Success rich: replies with rich message
  it('replies with rich message when successReply=rich', async () => {
    const richConfig = rulesConfigSchema.parse({
      defaults: {},
      rules: [{
        name: 'Test Playlist',
        enabled: true,
        when: { command: 'song' },
        playlist: { spotify: 'Test Playlist' },
      }],
      notifications: {
        onFailure: true,
        onLowConfidence: true,
        confidenceThreshold: 0.9,
        recipients: 'me',
        successReply: 'rich',
      },
    });

    const spotify = makeMockSpotify();
    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    const botConfig = makeBotConfig({ config: richConfig, spotify });

    await handleMessage(msg, botConfig);

    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('Love Deluxe'),
    );
    expect(msg.reply).toHaveBeenCalledWith(
      expect.stringContaining('https://open.spotify.com/track/abc123'),
    );
  });

  // Test 11: Success none: adds track, no reply
  it('adds track without reply when successReply=none', async () => {
    const noneConfig = rulesConfigSchema.parse({
      defaults: {},
      rules: [{
        name: 'Test Playlist',
        enabled: true,
        when: { command: 'song' },
        playlist: { spotify: 'Test Playlist' },
      }],
      notifications: {
        onFailure: true,
        onLowConfidence: true,
        confidenceThreshold: 0.9,
        recipients: 'me',
        successReply: 'none',
      },
    });

    const spotify = makeMockSpotify();
    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    const botConfig = makeBotConfig({ config: noneConfig, spotify });

    await handleMessage(msg, botConfig);

    expect(spotify.addTrackToPlaylist).toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();
  });

  // Test 12: Spotify error during resolve: replies with ❌ generic
  it('replies with generic error when Spotify throws during resolve', async () => {
    const spotify = makeMockSpotify({
      searchTrack: vi.fn().mockRejectedValue(new Error('Spotify API failure')),
      getTrackById: vi.fn().mockRejectedValue(new Error('Spotify API failure')),
    });
    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    const botConfig = makeBotConfig({ spotify });

    await handleMessage(msg, botConfig);

    expect(msg.reply).toHaveBeenCalledWith('❌ Something went wrong — try again');
  });

  // Test 13: Spotify error during add: replies with ❌ generic
  it('replies with generic error when Spotify throws during add', async () => {
    const spotify = makeMockSpotify({
      addTrackToPlaylist: vi.fn().mockRejectedValue(new Error('Spotify API failure')),
    });
    const msg = makeMockMsg('!song Sade - No Ordinary Love');
    const botConfig = makeBotConfig({ spotify });

    await handleMessage(msg, botConfig);

    expect(msg.reply).toHaveBeenCalledWith('❌ Something went wrong — try again');
  });

  // Test 14: Auto-capture: Spotify URL in plain message
  it('auto-capture: adds Spotify URL from plain message to master playlist, no group reply', async () => {
    const db = openDb(':memory:');
    const spotify = makeMockSpotify();
    const msg = makeMockMsg('Check this out https://open.spotify.com/track/abc123');
    const botConfig = makeBotConfig({ spotify }, db);

    await handleMessage(msg, botConfig);

    expect(spotify.getTrackById).toHaveBeenCalled();
    expect(spotify.findOrCreatePlaylist).toHaveBeenCalledWith('Test Master Playlist');
    expect(spotify.addTrackToPlaylist).toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM submissions').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('added');
    expect(rows[0].source_platform).toBe('spotify');
    expect(rows[0].source_url).toBe('https://open.spotify.com/track/abc123');
  });

  // Test 15a: Auto-capture: YouTube URL resolved via Songlink successfully
  it('auto-capture: resolves YouTube URL via Songlink and adds to master playlist', async () => {
    const db = openDb(':memory:');
    vi.spyOn(rateLimiterModule.songlinkLimiter, 'acquire').mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        entityUniqueId: 'SPOTIFY_SONG::abc123',
        userCountry: 'US',
        pageUrl: 'https://song.link/s/abc123',
        entitiesByUniqueId: {
          'SPOTIFY_SONG::abc123': {
            id: 'abc123', type: 'song', title: 'No Ordinary Love',
            artistName: 'Sade', apiProvider: 'spotify', platforms: ['spotify'],
          },
        },
        linksByPlatform: {
          spotify: { country: 'US', url: 'https://open.spotify.com/track/abc123', entityUniqueId: 'SPOTIFY_SONG::abc123' },
        },
      }),
    } as Response);

    const spotify = makeMockSpotify();
    const botConfig = makeBotConfig({ spotify }, db);
    const msg = makeMockMsg('check this out https://www.youtube.com/watch?v=abc123');

    await handleMessage(msg, botConfig);

    expect(spotify.findOrCreatePlaylist).toHaveBeenCalledWith('Test Master Playlist');
    expect(spotify.addTrackToPlaylist).toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM submissions').all() as Array<{ status: string; source_platform: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('added');
    expect(rows[0].source_platform).toBe('youtube');
  });

  // Test 15b: Auto-capture: YouTube URL — Songlink fails, stored as not-found
  it('auto-capture: stores not-found when Songlink cannot resolve YouTube URL', async () => {
    const db = openDb(':memory:');
    vi.spyOn(rateLimiterModule.songlinkLimiter, 'acquire').mockResolvedValue(undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);

    const spotify = makeMockSpotify();
    const botConfig = makeBotConfig({ spotify }, db);
    const msg = makeMockMsg('https://www.youtube.com/watch?v=xyz999');

    await handleMessage(msg, botConfig);

    expect(spotify.addTrackToPlaylist).not.toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM submissions').all() as Array<{ status: string; source_platform: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('not-found');
    expect(rows[0].source_platform).toBe('youtube');
  });

  // Test 16: Auto-capture: duplicate Spotify URL
  it('auto-capture: duplicate Spotify URL stored as duplicate, addTrackToPlaylist not called', async () => {
    const db = openDb(':memory:');
    const spotify = makeMockSpotify({
      isTrackInPlaylist: vi.fn().mockResolvedValue(true),
    });
    const msg = makeMockMsg('https://open.spotify.com/track/abc123');
    const botConfig = makeBotConfig({ spotify }, db);

    await handleMessage(msg, botConfig);

    expect(spotify.addTrackToPlaylist).not.toHaveBeenCalled();
    expect(msg.reply).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM submissions').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('duplicate');
  });

  // Test 17: Auto-capture: plain message with no URLs
  it('auto-capture: plain message with no URLs makes no DB inserts and no Spotify calls', async () => {
    const db = openDb(':memory:');
    const spotify = makeMockSpotify();
    const msg = makeMockMsg('Hey everyone, how is it going?');
    const botConfig = makeBotConfig({ spotify }, db);

    await handleMessage(msg, botConfig);

    expect(spotify.searchTrack).not.toHaveBeenCalled();
    expect(spotify.getTrackById).not.toHaveBeenCalled();
    expect(spotify.addTrackToPlaylist).not.toHaveBeenCalled();

    const rows = db.prepare('SELECT * FROM submissions').all();
    expect(rows).toHaveLength(0);
  });

  it('routes an explicit !jev request to the guarded responder and stops normal capture', async () => {
    const jevRespond = vi.fn().mockResolvedValue('🧠 Jev read: friendly knife fight.');
    const spotify = makeMockSpotify();
    const msg = makeMockMsg('!jev read the room', {
      priorMessages: [{ sender: 'bob', timeMs: 1, text: 'this round is chaos' }],
    });

    await handleMessage(msg, makeBotConfig({ spotify, jevRespond }));

    expect(jevRespond).toHaveBeenCalledWith(expect.objectContaining({
      chatId: msg.from,
      prompt: 'read the room',
      priorMessages: msg.priorMessages,
    }));
    expect(msg.reply).toHaveBeenCalledWith('🧠 Jev read: friendly knife fight.');
    expect(spotify.searchTrack).not.toHaveBeenCalled();
  });

  describe('mention reactions behind the preview gate', () => {
    const SONG = 'BmCQHGE3k0a0ST5ZDPFmqW@g.us';
    const CMU_ONLY = 'CmuOnlyGroup1@g.us';
    const OTHER = 'NeitherGroup9@g.us';
    const plain = (from: string, body = 'hey @bot what a day', o: Partial<WhatsAppMessage> = {}) =>
      makeMockMsg(body, { from, mentionsBot: true, ...o });

    function setup(o: { preview?: string[]; format?: string[]; unsetPreview?: boolean } = {}) {
      const reactToMention = vi.fn().mockResolvedValue(undefined);
      const jevRespond = vi.fn().mockResolvedValue('jev says hi');
      const catchMeUp = vi.fn().mockResolvedValue(undefined);
      const spotify = makeMockSpotify();
      const db = openDb(':memory:');
      const cfg = makeBotConfig({
        spotify,
        jevRespond,
        catchMeUp,
        reactToMention,
        reactGroupIds: new Set([CMU_ONLY, SONG]),
        ...(o.unsetPreview ? {} : { preview: memoryCmuPreview(o.preview ?? [], [], [], o.format ?? []) }),
      }, db);
      return { reactToMention, jevRespond, catchMeUp, spotify, db, cfg };
    }

    it('preview CMU-only group: plain mention reacts once, no Jev, nothing captured', async () => {
      const t = setup({ preview: [CMU_ONLY] });
      const msg = plain(CMU_ONLY);
      await handleMessage(msg, t.cfg);
      expect(t.reactToMention).toHaveBeenCalledTimes(1);
      expect(t.reactToMention).toHaveBeenCalledWith(msg);
      expect(t.jevRespond).not.toHaveBeenCalled();
      expect(msg.reply).not.toHaveBeenCalled();
      expect(t.db.prepare('SELECT * FROM submissions').all()).toHaveLength(0);
    });

    it('preview song-capture group: plain mention reacts, no Jev text reply', async () => {
      const t = setup({ preview: [SONG] });
      const msg = plain(SONG);
      await handleMessage(msg, t.cfg);
      expect(t.reactToMention).toHaveBeenCalledTimes(1);
      expect(t.jevRespond).not.toHaveBeenCalled();
      expect(msg.reply).not.toHaveBeenCalled();
    });

    it('preview song-capture group: a mention with a Spotify URL is captured, no reaction', async () => {
      const t = setup({ preview: [SONG] });
      const msg = plain(SONG, '@bot https://open.spotify.com/track/abc123');
      await handleMessage(msg, t.cfg);
      expect(t.reactToMention).not.toHaveBeenCalled();
      expect(t.spotify.addTrackToPlaylist).toHaveBeenCalled();
    });

    it('preview song-capture group: a mention with a !song command takes the !song path, no reaction', async () => {
      const t = setup({ preview: [SONG] });
      const msg = plain(SONG, '!song Test Artist - Test Title');
      await handleMessage(msg, t.cfg);
      expect(t.reactToMention).not.toHaveBeenCalled();
      expect(t.spotify.searchTrack).toHaveBeenCalled();
    });

    it('preview song-capture group: a prompt-answer mention takes the prompt path, no reaction', async () => {
      const t = setup({ preview: [SONG] });
      createPromptTables(t.db);
      insertPrompt(t.db, {
        id: 'p1',
        chatId: SONG,
        options: [{ id: 'a', label: 'Koziol' }],
        templates: { matched: ['got {name}'], ambiguous: ['which?'], unmatched: ['no idea'] },
        acceptInline: true,
      });
      const msg = plain(SONG, 'Koziol');
      await handleMessage(msg, t.cfg);
      expect(t.reactToMention).not.toHaveBeenCalled();
      expect(msg.reply).toHaveBeenCalled();
      expect(t.jevRespond).not.toHaveBeenCalled();
    });

    it('preview: !jev without a mention is ordinary chat (no reply, no reaction)', async () => {
      const t = setup({ preview: [SONG] });
      const msg = makeMockMsg('!jev read the room', { from: SONG });
      await handleMessage(msg, t.cfg);
      expect(t.jevRespond).not.toHaveBeenCalled();
      expect(t.reactToMention).not.toHaveBeenCalled();
      expect(msg.reply).not.toHaveBeenCalled();
    });

    it('group in both lists (preview): song-capture branch, reaction exactly once', async () => {
      const t = setup({ preview: [SONG] });
      await handleMessage(plain(SONG, '@bot https://open.spotify.com/track/abc123'), t.cfg);
      expect(t.reactToMention).not.toHaveBeenCalled();
      const t2 = setup({ preview: [SONG] });
      await handleMessage(plain(SONG), t2.cfg);
      expect(t2.reactToMention).toHaveBeenCalledTimes(1);
    });

    it('non-preview song-capture group: Jev text reply as today, no reaction', async () => {
      const t = setup();
      const msg = plain(SONG);
      await handleMessage(msg, t.cfg);
      expect(t.jevRespond).toHaveBeenCalledTimes(1);
      expect(msg.reply).toHaveBeenCalledWith('jev says hi');
      expect(t.reactToMention).not.toHaveBeenCalled();
    });

    it('non-preview CMU-only group: nothing is called', async () => {
      const t = setup();
      const msg = plain(CMU_ONLY);
      await handleMessage(msg, t.cfg);
      expect(t.reactToMention).not.toHaveBeenCalled();
      expect(t.jevRespond).not.toHaveBeenCalled();
      expect(msg.reply).not.toHaveBeenCalled();
    });

    it('preview unset behaves as non-preview everywhere', async () => {
      const t = setup({ unsetPreview: true });
      await handleMessage(plain(CMU_ONLY), t.cfg);
      const msg = plain(SONG);
      await handleMessage(msg, t.cfg);
      expect(t.reactToMention).not.toHaveBeenCalled();
      expect(t.jevRespond).toHaveBeenCalledTimes(1);
    });

    it('recap-bot-calls: a non-preview group never reaches catchMeUp and keeps the old mention path', async () => {
      const t = setup({ preview: [CMU_ONLY] });
      await handleMessage(plain(SONG, '@bot recap-bot-calls'), t.cfg);
      expect(t.catchMeUp).not.toHaveBeenCalled();
      expect(t.jevRespond).toHaveBeenCalledTimes(1);
      expect(t.reactToMention).not.toHaveBeenCalled();
    });

    it('recap-bot-calls: a preview group routes to catchMeUp with kind recap', async () => {
      const t = setup({ preview: [CMU_ONLY] });
      const msg = plain(CMU_ONLY, '@bot recap-bot-calls');
      await handleMessage(msg, t.cfg);
      expect(t.catchMeUp).toHaveBeenCalledWith(msg, { kind: 'recap' });
    });

    it('forget dl: a non-format group does not treat it as a command (today path)', async () => {
      const t = setup({ format: [] });
      await handleMessage(plain(SONG, '@bot forget dl'), t.cfg);
      expect(t.catchMeUp).not.toHaveBeenCalled();
      expect(t.jevRespond).toHaveBeenCalledTimes(1);
    });

    it('forget dl: a format group reaches catchMeUp with scope dl', async () => {
      const t = setup({ preview: [CMU_ONLY], format: [CMU_ONLY] });
      const msg = plain(CMU_ONLY, '@bot forget dl');
      await handleMessage(msg, t.cfg);
      expect(t.catchMeUp).toHaveBeenCalledWith(msg, { kind: 'forget', scope: 'dl', target: 'self' });
    });

    it('plain forget is not gated by the format list', async () => {
      const t = setup({ preview: [CMU_ONLY] });
      const msg = plain(CMU_ONLY, '@bot forget');
      await handleMessage(msg, t.cfg);
      expect(t.catchMeUp).toHaveBeenCalledWith(msg, { kind: 'forget', scope: 'both', target: 'self' });
    });

    it('group in neither list: nothing called; catch-me-up still routes in either kind of group', async () => {
      const t = setup({ preview: [OTHER, CMU_ONLY] });
      const msg = plain(OTHER);
      await handleMessage(msg, t.cfg);
      expect(t.reactToMention).not.toHaveBeenCalled();
      expect(t.jevRespond).not.toHaveBeenCalled();
      expect(msg.reply).not.toHaveBeenCalled();
      for (const g of [OTHER, CMU_ONLY, SONG]) {
        await handleMessage(plain(g, '@bot catch me up'), t.cfg);
      }
      expect(t.catchMeUp).toHaveBeenCalledTimes(3);
      expect(t.reactToMention).not.toHaveBeenCalled();
    });
  });
  describe('DM commands typed in the group', () => {
    const FMT = '120363000000000001@g.us';
    const make = (o: { format?: string[]; body?: string; wrongPlaceResult?: boolean; omit?: boolean } = {}) => {
      const wrongPlace = vi.fn().mockResolvedValue(o.wrongPlaceResult ?? true);
      const reactToMention = vi.fn().mockResolvedValue(undefined);
      const catchMeUp = vi.fn().mockResolvedValue(undefined);
      const cfg = makeBotConfig({
        reactToMention, catchMeUp, reactGroupIds: new Set([FMT]),
        ...(o.omit ? {} : { wrongPlace }),
        preview: memoryCmuPreview([FMT], [], [], o.format ?? [FMT]),
      });
      const msg = makeMockMsg(o.body ?? '@bot top-pics', { from: FMT, mentionsBot: true });
      return { wrongPlace, reactToMention, catchMeUp, cfg, msg };
    };

    it('format group + DM-only command: wrongPlace handles it, no emoji pick', async () => {
      const t = make();
      await handleMessage(t.msg, t.cfg);
      expect(t.wrongPlace).toHaveBeenCalledWith(t.msg);
      expect(t.reactToMention).not.toHaveBeenCalled();
    });

    it('wrongPlace returns false: falls through to the joke emoji', async () => {
      const t = make({ wrongPlaceResult: false });
      await handleMessage(t.msg, t.cfg);
      expect(t.reactToMention).toHaveBeenCalledTimes(1);
    });

    it('group not in format list: no wrongPlace, joke emoji', async () => {
      const t = make({ format: [] });
      await handleMessage(t.msg, t.cfg);
      expect(t.wrongPlace).not.toHaveBeenCalled();
      expect(t.reactToMention).toHaveBeenCalledTimes(1);
    });

    it('unset wrongPlace: today behaviour', async () => {
      const t = make({ omit: true });
      await handleMessage(t.msg, t.cfg);
      expect(t.reactToMention).toHaveBeenCalledTimes(1);
    });

    it('@bot help goes to catch-me-up, not wrongPlace', async () => {
      const t = make({ body: '@bot help' });
      await handleMessage(t.msg, t.cfg);
      expect(t.wrongPlace).not.toHaveBeenCalled();
    });

    it('plain mention is not a DM command', async () => {
      const t = make({ body: '@bot what a day' });
      await handleMessage(t.msg, t.cfg);
      expect(t.wrongPlace).not.toHaveBeenCalled();
      expect(t.reactToMention).toHaveBeenCalledTimes(1);
    });
  });
});
