import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/storage/db.js';
import { handleMessage, type WhatsAppMessage, type BotConfig } from '../src/bot/handler.js';
import { rulesConfigSchema } from '../src/config/types.js';
import type { ISpotifyAdapter } from '../src/music/types.js';

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
    author: '16171234567@c.us',
    fromMe: false,
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
    sendDm: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleMessage', () => {
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

  // Test 2: Ignores fromMe
  it('ignores messages sent by the bot itself (fromMe)', async () => {
    const msg = makeMockMsg('!song Sade - No Ordinary Love', {
      fromMe: true,
    });
    const spotify = makeMockSpotify();
    const botConfig = makeBotConfig({ spotify });

    await handleMessage(msg, botConfig);

    expect(spotify.searchTrack).not.toHaveBeenCalled();
    expect(spotify.getTrackById).not.toHaveBeenCalled();
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
});
