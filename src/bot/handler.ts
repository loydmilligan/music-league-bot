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
import { interpretMessage } from '../chat/prompts/engine.js';
import { getDirectPrompts, getOpenPrompts, hasAnswered, recordAnswer } from '../chat/prompts/store.js';
import { extractJevPrompt, type JevChatRequest } from '../chat/jevResponder.js';
import { parseCmuCommand, parseDmCommand, stripMentionAndFiller, DM_ONLY_KINDS, type CmuCommand } from './cmuCommand.js';
import { memoryCmuPreview, type CmuPreview } from './cmuPreview.js';

export interface WhatsAppMessage {
  body: string;
  from: string;           // group chat id, e.g. "XXXX@g.us"
  chatName: string;       // human-readable group name, e.g. "Hip Jammers"
  author: string;         // sender id, e.g. "16171234567@c.us"
  fromMe: boolean;
  capturedAt: string;     // ISO timestamp of the message
  priorMessages: Array<{ sender: string; timeMs: number; text: string }>;
  /** Set when this message quote-replies something the bot itself sent. */
  quotedFromBot?: boolean;
  /** Text/caption of the quoted message, when this is a quote-reply. */
  quotedText?: string;
  /** True when WhatsApp's plain message payload says the bot account was @mentioned. */
  mentionsBot?: boolean;
  /** The sender's WhatsApp display name, from the plain message payload. */
  notifyName?: string;
  /** Serialized wids ("user@server") this message @mentions. */
  mentionedIds?: string[];
  /** Every id the bot account is known by, so a mention of the bot is told apart from a player. */
  selfIds?: string[];
  reply(text: string): Promise<void>;
  getContact(): Promise<{ pushname: string }>;
  /** React to this message with an emoji. */
  react?(emoji: string): Promise<void>;
}

export interface BotConfig {
  config: RulesConfig;
  spotify: ISpotifyAdapter;
  db: Database.Database;
  allowedGroupIds: string[];
  ownerPhone: string;
  masterPlaylistName: string;
  sendDm(phone: string, text: string): Promise<void>;
  jevRespond?: (request: JevChatRequest) => Promise<string>;
  /** "@bot catch me up" (src/bot/catchMeUp.ts). Unwired = the phrase falls through to Jev. */
  catchMeUp?: (msg: WhatsAppMessage, cmd: CmuCommand) => Promise<void>;
  /** Emoji reaction to a non-command @-mention. Acts only in preview groups. */
  reactToMention?: (msg: WhatsAppMessage) => Promise<void>;
  /** The CMU_GROUPS group ids (matched exactly): groups with no song capture that still get reactions. */
  reactGroupIds?: Set<string>;
  /** Preview gate; default is empty, so every group keeps today's behaviour. */
  preview?: CmuPreview;
  /** Player commands by private DM (src/bot/cmuDm.ts). True = handled; false = on to prompt answers. */
  cmuDm?: (msg: WhatsAppMessage) => Promise<boolean>;
  /** A DM-only command typed in a format group (src/bot/wrongPlace.ts). True = handled. Unset = today's behaviour. */
  wrongPlace?: (msg: WhatsAppMessage) => Promise<boolean>;
}

/** Runs wrongPlace for an @bot DM-only command in a format-allowlisted group; never throws. */
async function handledAsWrongPlace(msg: WhatsAppMessage, botConfig: BotConfig, preview: CmuPreview): Promise<boolean> {
  if (!botConfig.wrongPlace || preview.isFormatPreview?.(msg.from) !== true) return false;
  const cmd = parseDmCommand(stripMentionAndFiller(msg.body));
  if (!cmd || !DM_ONLY_KINDS.has(cmd.kind)) return false;
  try {
    return await botConfig.wrongPlace(msg);
  } catch (err) {
    console.error('[cmu] wrong-place failed:', err instanceof Error ? err.name : 'error');
    return false;
  }
}

export async function handleMessage(msg: WhatsAppMessage, botConfig: BotConfig): Promise<void> {
  const { config, spotify, db, allowedGroupIds, ownerPhone, sendDm } = botConfig;
  const preview = botConfig.preview ?? memoryCmuPreview();

  // Never react to ourselves. Previously implicit — our own messages carry our
  // LID in `from`, so the @g.us allowlist below dropped them — but the direct
  // branch accepts non-group chats by design, which would feed the bot its own
  // replies. Those replies quote a player's name ("Logged: Dave Steingart…"),
  // so it would answer its own prompt, then loop on the duplicate reply forever.
  if (msg.fromMe) return;

  // A private message can only ever be a prompt answer — never song capture —
  // and is deliberately exempt from the group allowlist, which exists to stop
  // the bot acting in groups it was not invited to reason about.
  if (!msg.from.endsWith('@g.us')) {
    // An exact DM command from a preview person wins; everything else stays a prompt answer.
    if (botConfig.cmuDm) {
      try {
        if (await botConfig.cmuDm(msg)) return;
      } catch (err) {
        console.error('[cmu] dm router failed:', err instanceof Error ? err.name : 'error');
      }
    }
    await handlePromptAnswer(msg, botConfig, true);
    return;
  }

  // Catch-me-up runs before every other path (C2) and before the capture log
  // below, so the request's text is never logged. It is gated by its own
  // CMU_GROUPS map rather than the song-capture allowlist.
  if (botConfig.catchMeUp) {
    let cmd = parseCmuCommand(msg.body, msg.mentionsBot ?? false, msg.mentionedIds ?? [], new Set(msg.selfIds ?? []));
    // recap-bot-calls is a preview-group command; elsewhere it is an ordinary mention.
    if (cmd?.kind === 'recap' && !preview.isPreview(msg.from)) cmd = null;
    // forget dl / forget sybg are sprint 4: outside a format group they are not commands, as before.
    if (cmd?.kind === 'forget' && cmd.scope !== 'both' && preview.isFormatPreview?.(msg.from) !== true) cmd = null;
    if (cmd) {
      await botConfig.catchMeUp(msg, cmd);
      return;
    }
  }

  const inPreview = preview.isPreview(msg.from);
  const inAllowlist = allowedGroupIds.some((id) => msg.from.includes(id));

  // Preview CMU-only group (not a song-capture group): a plain mention gets a reaction.
  if (inPreview && msg.mentionsBot && botConfig.reactGroupIds?.has(msg.from) && !inAllowlist) {
    if (await handledAsWrongPlace(msg, botConfig, preview)) return;
    await botConfig.reactToMention?.(msg);
    return;
  }

  if (!inAllowlist) return;

  console.log('[bot] captured from group:', msg.from, '|', msg.body.slice(0, 80));

  // Path 0: an answer to an open prompt. Runs first so a reply like "Koziol"
  // is never also scanned for song URLs, and returns early when it lands.
  if (await handlePromptAnswer(msg, botConfig)) return;

  // Preview groups: a mention with no music URL gets a reaction instead of Jev's text reply.
  if (inPreview && msg.mentionsBot && detectMusicUrls(msg.body).length === 0 && parseMessage(msg.body) === null) {
    if (await handledAsWrongPlace(msg, botConfig, preview)) return;
    await botConfig.reactToMention?.(msg);
    return;
  }

  // Path J: explicitly ask the bot for a compact Jev read. Disabled unless a
  // responder is wired at startup; ordinary chat never causes an AI call.
  const jevPrompt = inPreview ? null : extractJevPrompt(msg.body, msg.mentionsBot);
  if (jevPrompt && botConfig.jevRespond) {
    let authorName: string | undefined;
    try {
      authorName = (await msg.getContact()).pushname || undefined;
    } catch { /* stable author id remains available */ }
    try {
      const reply = await botConfig.jevRespond({
        chatId: msg.from,
        chatName: msg.chatName,
        authorId: msg.author,
        authorName,
        prompt: jevPrompt,
        priorMessages: msg.priorMessages,
      });
      await msg.reply(reply);
    } catch (err) {
      console.error('[jev-chat] request failed:', err);
      await msg.reply('Jev tripped over its own clipboard. Try again in a minute.');
    }
    return;
  }

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

/**
 * Route a message to the generic prompt engine. Returns true when it was an
 * answer (and therefore fully handled).
 *
 * The engine is pure and knows nothing about songs; everything song-shaped lives
 * in whoever created the prompt. Failures here are swallowed deliberately — a
 * bug in a chat game must never take down song capture.
 */
async function handlePromptAnswer(
  msg: WhatsAppMessage,
  botConfig: BotConfig,
  isDirect = false,
): Promise<boolean> {
  const { db } = botConfig;
  try {
    const open = isDirect ? getDirectPrompts(db) : getOpenPrompts(db, msg.from);
    if (open.length === 0) return false;

    let authorName = msg.author;
    try {
      authorName = (await msg.getContact()).pushname || msg.author;
    } catch { /* @lid contacts may not resolve */ }

    const outcome = interpretMessage(
      {
        chatId: msg.from,
        authorId: msg.author,
        authorName,
        text: msg.body,
        quotedFromBot: msg.quotedFromBot,
        quotedText: msg.quotedText,
        isDirect,
      },
      open,
      { hasAnswered: (promptId, authorId) => hasAnswered(db, promptId, authorId) },
    );
    if (!outcome) return false;

    if (!outcome.duplicate) {
      recordAnswer(db, {
        promptId: outcome.promptId,
        authorId: outcome.authorId,
        authorName,
        answerText: outcome.answerText,
        resolution: outcome.resolution,
        trigger: outcome.trigger,
      });
    }
    console.log(
      `[prompt] ${outcome.promptId} ← ${authorName} "${outcome.answerText}" ` +
      `→ ${outcome.resolution.kind}${outcome.duplicate ? ' (duplicate)' : ''}`,
    );
    if (outcome.reply) await msg.reply(outcome.reply);
    return true;
  } catch (err) {
    console.error('[prompt] error handling answer:', err);
    return false;
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
