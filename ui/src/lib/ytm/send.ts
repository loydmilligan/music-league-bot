import type Database from 'better-sqlite3';
import type { VideoReview } from './videoReview.js';
import { getReview, includedVideoIds, markSent, markFailed } from './videoReview.js';
import { credsFromEnv, createPlaylist } from './youtube.js';

const botControlUrl = () => process.env.BOT_CONTROL_URL ?? 'http://bot:3003';

/**
 * WhatsApp collapses a message down to a single link preview, so two links in
 * one message loses one of them. Anything with more than one link goes out as
 * separate, sequential messages.
 */
export async function sendText(target: string, text: string, fetchFn: typeof fetch = fetch): Promise<void> {
  // /say is the plain-text route; /send is the digest sender and takes a
  // roundId, not a message.
  const res = await fetchFn(`${botControlUrl()}/say`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target, text }),
  });
  if (!res.ok) throw new Error(`whatsapp say ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

export interface CompleteDeps {
  fetchFn?: typeof fetch;
  now?: () => string;
  roundName: string;
  leagueTitle: string;
}

/**
 * Build the approved playlist and post it.
 *
 * Ordering matters when the audio playlist has NOT already gone out: audio
 * first, then video, as two messages — that is the order the group reads them
 * in, and the audio link is the one most people want.
 *
 * An approved review with nothing included is not an error, it is a decision:
 * no playlist is built and no message is sent.
 */
export async function completeApproval(
  db: Database.Database, roundId: number, deps: CompleteDeps,
): Promise<{ sent: boolean; videoUrl: string | null }> {
  const now = deps.now ?? (() => new Date().toISOString());
  const fetchFn = deps.fetchFn ?? fetch;
  const review = getReview(db, roundId);
  if (!review) throw new Error(`no review for round ${roundId}`);
  try {
    const videoIds = includedVideoIds(review.picks);
    if (!videoIds.length) {
      markSent(db, roundId, '', now());
      return { sent: false, videoUrl: null };
    }
    const creds = credsFromEnv();
    if (!creds) throw new Error('YOUTUBE_* credentials missing from the bot-ui environment');
    const playlistId = await createPlaylist(creds, {
      title: `${deps.leagueTitle} · ${deps.roundName} — the videos`,
      description: 'Music League — the music videos for this round.',
      videoIds,
    }, { fetchFn });
    // Plain YouTube, not music.youtube: these are videos to watch.
    const videoUrl = `https://www.youtube.com/playlist?list=${playlistId}`;

    if (!review.audioSent && review.audioUrl) {
      await sendText(review.target, `🎧 *${deps.roundName}* — this week's playlist, now for the YouTube Music crowd:\n${review.audioUrl}`, fetchFn);
    }
    await sendText(review.target, `📺 …and the music videos for *${deps.roundName}*:\n${videoUrl}`, fetchFn);

    markSent(db, roundId, videoUrl, now());
    return { sent: true, videoUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    markFailed(db, roundId, msg, now());
    throw e;
  }
}

export type { VideoReview };
