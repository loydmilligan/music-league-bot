import type Database from 'better-sqlite3';
import type { ISpotifyAdapter } from '../music/types.js';
import type { RulesConfig, Notifications } from '../config/types.js';
import { parseMessage } from '../parser/parseMessage.js';
import { resolveTrack } from '../resolver/resolveTrack.js';
import { applyRules } from '../rules/engine.js';
import { getISOWeekNumber } from '../rules/templates.js';
import { insertSubmission } from '../storage/submissions.js';
import { detectMusicUrls } from './urlDetector.js';
import { resolveSonglinkUrl } from '../resolver/songlinkResolver.js';
import { songlinkLimiter } from '../resolver/songlinkRateLimiter.js';
import { insertChatCapture } from '../storage/chatDb.js';

export interface WhatsAppMessage {
  body: string;
  from: string;           // group chat id, e.g. "XXXX@g.us"
  chatName: string;       // human-readable group name, e.g. "Hip Jammers"
  author: string;         // sender id, e.g. "16171234567@c.us"
  fromMe: boolean;
  capturedAt: string;     // ISO timestamp of the message
  priorMessages: Array<{ sender: string; timeMs: number; text: string }>;
  reply(text: string): Promise<void>;
  getContact(): Promise<{ pushname: string }>;
}

export interface BotConfig {
  config: RulesConfig;
  spotify: ISpotifyAdapter;
  db: Database.Database;
  allowedGroupIds: string[];
  ownerPhone: string;
  masterPlaylistName: string;
  sendDm(phone: string, text: string): Promise<void>;
}

export async function handleMessage(msg: WhatsAppMessage, botConfig: BotConfig): Promise<void> {
  const { config, spotify, db, allowedGroupIds, ownerPhone, sendDm } = botConfig;

  if (!allowedGroupIds.some((id) => msg.from.includes(id))) return;

  console.log('[bot] captured from group:', msg.from, '|', msg.body.slice(0, 80));

  // Path A: explicit !song command
  const parsed = parseMessage(msg.body);
  if (!parsed) {
    // Path B: auto-capture — detect music URLs in any message
    const detected = detectMusicUrls(msg.body);
    for (const { url, platform } of detected) {
      await handleAutoCapture(url, platform, msg, botConfig);
    }
    return;
  }

  let submitterName = msg.author;
  try {
    const contact = await msg.getContact();
    submitterName = contact.pushname || msg.author;
  } catch {
    // @lid (Multi-Device) contacts may not resolve — fall back to author ID
  }
  const notifications: Notifications = config.notifications ?? {
    onFailure: true,
    onLowConfidence: true,
    confidenceThreshold: 0.9,
    recipients: 'me',
    successReply: 'simple',
  };

  let track = null;
  try {
    const resolution = await resolveTrack(
      parsed,
      spotify,
      notifications.confidenceThreshold,
    );

    if (resolution.status === 'not-found') {
      if (notifications.onFailure) {
        const failMsg = `❌ Couldn't find a track for: ${parsed.rawText.replace(/^!song\s*/i, '')}`;
        await notifyRecipients(failMsg, msg, ownerPhone, notifications.recipients, sendDm);
      }
      insertSubmission(db, {
        submitterId: msg.author,
        submitterName,
        rawText: msg.body,
        track: null,
        status: 'not-found',
      });
      return;
    }

    track = resolution.track;

    if (resolution.status === 'low-confidence' && notifications.onLowConfidence && track) {
      const lowMsg = `⚠️ Added "${track.title}" by ${track.artist} — but I wasn't sure this was the right track. Check it looks right.`;
      await notifyRecipients(lowMsg, msg, ownerPhone, notifications.recipients, sendDm);
    }
  } catch (err) {
    console.error('[handler] Spotify error during resolve:', err);
    await msg.reply('❌ Something went wrong — try again');
    return;
  }

  if (!track) return;

  const weekNumber = getISOWeekNumber(new Date());
  const year = new Date().getFullYear();
  const matches = applyRules(config, {
    command: parsed.command,
    tags: parsed.tags,
    submittedBy: msg.author,
    groupId: msg.from,
  }, { weekNumber, year });

  if (matches.length === 0) {
    insertSubmission(db, {
      submitterId: msg.author,
      submitterName,
      rawText: msg.body,
      track,
      status: 'no-rule',
    });
    return;
  }

  for (const match of matches) {
    if (!match.spotify) continue;

    try {
      const playlistId = await spotify.findOrCreatePlaylist(match.spotify);
      const isDupe = await spotify.isTrackInPlaylist(playlistId, track.spotifyUri!);

      if (isDupe) {
        await msg.reply(`⚠️ "${track.title}" by ${track.artist} is already in ${match.spotify} — not added`);
        insertSubmission(db, {
          submitterId: msg.author,
          submitterName,
          rawText: msg.body,
          track,
          playlistId,
          playlistName: match.spotify,
          status: 'duplicate',
        });
      } else {
        await spotify.addTrackToPlaylist(playlistId, track.spotifyUri!);
        const successReply = notifications.successReply ?? 'simple';
        if (successReply === 'simple') {
          await msg.reply(`✅ Added "${track.title}" by ${track.artist} to ${match.spotify}`);
        } else if (successReply === 'rich') {
          const dur = msToMinSec(track.durationMs ?? 0);
          await msg.reply(`✅ Added "${track.title}" by ${track.artist} · ${track.album} · ${dur} → ${match.spotify}\n${track.sourceUrl}`);
        }
        insertSubmission(db, {
          submitterId: msg.author,
          submitterName,
          rawText: msg.body,
          track,
          playlistId,
          playlistName: match.spotify,
          status: 'added',
        });
      }
    } catch (err) {
      console.error('[handler] Spotify error during add:', err);
      await msg.reply('❌ Something went wrong — try again');
    }
  }
}

async function handleAutoCapture(
  detectedUrl: string,
  platform: string,
  msg: WhatsAppMessage,
  botConfig: BotConfig,
): Promise<void> {
  const { spotify, db, masterPlaylistName } = botConfig;

  let submitterName = msg.author;
  try {
    const contact = await msg.getContact();
    submitterName = contact.pushname || msg.author;
  } catch { /* @lid fallback */ }

  if (platform !== 'spotify') {
    try {
      await songlinkLimiter.acquire();
      const songlinkResult = await resolveSonglinkUrl(detectedUrl);

      if ('error' in songlinkResult || !songlinkResult.links.spotify) {
        insertSubmission(db, {
          submitterId: msg.author,
          submitterName,
          rawText: msg.body,
          track: null,
          status: 'not-found',
          sourcePlatform: platform,
          sourceUrl: detectedUrl,
        });
        return;
      }

      const spotifyUrl = songlinkResult.links.spotify;
      const resolution = await resolveTrack(
        { sourceUrl: spotifyUrl, command: 'auto', tags: [], rawText: detectedUrl, artistHint: null, titleHint: null },
        spotify,
        0.0,
      );

      if (!resolution.track) {
        insertSubmission(db, {
          submitterId: msg.author,
          submitterName,
          rawText: msg.body,
          track: null,
          status: 'not-found',
          sourcePlatform: platform,
          sourceUrl: detectedUrl,
        });
        return;
      }

      const track = resolution.track;
      const playlistId = await spotify.findOrCreatePlaylist(masterPlaylistName);
      const isDupe = await spotify.isTrackInPlaylist(playlistId, track.spotifyUri!);
      if (!isDupe) await spotify.addTrackToPlaylist(playlistId, track.spotifyUri!);

      insertSubmission(db, {
        submitterId: msg.author,
        submitterName,
        rawText: msg.body,
        track,
        playlistId,
        playlistName: masterPlaylistName,
        status: isDupe ? 'duplicate' : 'added',
        sourcePlatform: platform,
        sourceUrl: detectedUrl,
      });
      insertChatCapture({
        spotifyUri: track.spotifyUri!,
        title: track.title,
        artist: track.artist,
        album: track.album ?? null,
        albumArtUrl: null,
        year: null,
        durationSec: track.durationMs ? Math.round(track.durationMs / 1000) : null,
        chatName: msg.chatName,
        senderName: submitterName,
        capturedAt: msg.capturedAt,
        rawMessage: msg.body,
        priorMessages: msg.priorMessages,
      });
    } catch (err) {
      console.error('[handler] Songlink resolution error:', err);
    }
    return;
  }

  try {
    // For Spotify URLs, reuse the existing resolver
    // Build a minimal ParsedSubmission from the URL
    const parsed = { sourceUrl: detectedUrl, command: 'auto', tags: [], rawText: detectedUrl, artistHint: null, titleHint: null };
    const resolution = await resolveTrack(parsed, spotify, 0.0); // threshold 0.0 — accept anything

    if (!resolution.track) {
      insertSubmission(db, {
        submitterId: msg.author,
        submitterName,
        rawText: msg.body,
        track: null,
        status: 'not-found',
        sourcePlatform: platform,
        sourceUrl: detectedUrl,
      });
      return;
    }

    const track = resolution.track;
    const playlistId = await spotify.findOrCreatePlaylist(masterPlaylistName);
    const isDupe = await spotify.isTrackInPlaylist(playlistId, track.spotifyUri!);

    if (!isDupe) {
      await spotify.addTrackToPlaylist(playlistId, track.spotifyUri!);
    }

    insertSubmission(db, {
      submitterId: msg.author,
      submitterName,
      rawText: msg.body,
      track,
      playlistId,
      playlistName: masterPlaylistName,
      status: isDupe ? 'duplicate' : 'added',
      sourcePlatform: platform,
      sourceUrl: detectedUrl,
    });
    insertChatCapture({
      spotifyUri: track.spotifyUri!,
      title: track.title,
      artist: track.artist,
      album: track.album ?? null,
      albumArtUrl: null,
      year: null,
      durationSec: track.durationMs ? Math.round(track.durationMs / 1000) : null,
      chatName: msg.chatName,
      senderName: submitterName,
      capturedAt: msg.capturedAt,
      rawMessage: msg.body,
      priorMessages: msg.priorMessages,
    });
  } catch (err) {
    console.error('[handler] Auto-capture error:', err);
    // Silent — no group reply on auto-capture failure
  }
}

async function notifyRecipients(
  text: string,
  msg: WhatsAppMessage,
  ownerPhone: string,
  recipients: Notifications['recipients'],
  sendDm: (phone: string, text: string) => Promise<void>,
): Promise<void> {
  if (recipients === 'me' || recipients === 'me-and-submitter') {
    await sendDm(ownerPhone, text);
  }
  if (recipients === 'submitter' || recipients === 'me-and-submitter') {
    await sendDm(msg.author, text);
  }
}

function msToMinSec(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
