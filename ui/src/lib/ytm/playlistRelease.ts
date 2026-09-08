import type Database from 'better-sqlite3';
import { getReview, type VideoPick } from './videoReview.js';
import { reviewContext } from './reviewContext.js';
import { writePlaylistPage } from './playlistPage.js';
import { sendText } from './send.js';
import {
  pageForSlug, pageRoster, tallies, approvedMessages, claimMessage, type Message,
} from './playlistVotes.js';
import { appBaseUrl } from '$lib/config/urls.js';
import { notify } from '$lib/notifications/dispatch.js';

/**
 * Releasing a playlist message: the half that was missing.
 *
 * A message written on the page is stored `pending` and is invisible to
 * everyone — including, until this existed, to the person who has to approve
 * it. The page's "⏳ WITH MATT" chip was telling the truth about intent and
 * nothing about reality.
 *
 * Approving does two things, in this order: post it to the group, then rebuild
 * the page so the message also appears there. The order matters — the group is
 * the thing people actually read, and a page rebuild that fails must not stop
 * the message going out.
 */

/**
 * Rebuild a playlist page from current state. Also the only way vote tallies
 * baked into the static file get refreshed, so it is worth calling after any
 * decision rather than only when a message lands.
 */
export function regeneratePlaylistPage(db: Database.Database, slug: string): string | null {
  const ref = pageForSlug(db, slug);
  if (!ref) return null;
  const review = getReview(db, ref.roundId);
  if (!review) return null;
  const { roundName, leagueTitle, roundNumber } = reviewContext(db, ref.roundId);
  const picks: VideoPick[] = review.picks.filter((p) => p.included && p.chosen.length);
  return writePlaylistPage(slug, {
    roundName,
    leagueTitle,
    roundNumber,
    slug,
    picks,
    roster: pageRoster(db, ref.roundId),
    tallies: tallies(db, slug),
    messages: approvedMessages(db, slug),
    youtubeUrl: review.videoUrl,
  });
}

/** The song a message is about, for the WhatsApp post. */
function songFor(db: Database.Database, roundId: number, videoId: string): { title: string; artists: string } | null {
  const review = getReview(db, roundId);
  const pick = review?.picks.find((p) => p.chosen.includes(videoId));
  return pick ? { title: pick.title, artists: pick.artists } : null;
}

export interface ReleaseDeps {
  fetchFn?: typeof fetch;
  now?: () => string;
}

/**
 * Approve a message by its single-use token: claim it, post it, rebuild.
 *
 * Returns null when the token is unknown or already spent — which is also what
 * a double-tap on the notification looks like, and is why the claim happens
 * before the send.
 */
export async function approveMessage(
  db: Database.Database, token: string, deps: ReleaseDeps = {},
): Promise<{ message: Message; posted: boolean } | null> {
  const now = deps.now ?? (() => new Date().toISOString());
  const claimed = claimMessage(db, token, 'approved', now());
  if (!claimed) return null;

  const ref = pageForSlug(db, claimed.slug);
  const review = ref ? getReview(db, ref.roundId) : null;
  const song = ref ? songFor(db, ref.roundId, claimed.videoId) : null;
  const ctx = ref ? reviewContext(db, ref.roundId) : null;

  let posted = false;
  if (review?.target) {
    const lines = [
      `💬 *${claimed.playerName}* on ${song ? `*${song.title}* — ${song.artists}` : 'a video'}:`,
      `“${claimed.text}”`,
      '',
      `https://www.youtube.com/watch?v=${claimed.videoId}`,
    ];
    // The send is best-effort on purpose: the decision is already recorded, and
    // a wedged WhatsApp client must not un-approve a message or strand the
    // token. A failure here is visible in the logs and re-postable by hand.
    try {
      await sendText(review.target, lines.join('\n'), deps.fetchFn);
      posted = true;
    } catch (e) {
      console.error(`[playlist-release] posting message ${claimed.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  try {
    regeneratePlaylistPage(db, claimed.slug);
  } catch (e) {
    console.error(`[playlist-release] rebuilding ${claimed.slug} failed:`, e instanceof Error ? e.message : e);
  }

  void ctx;
  return { message: claimed, posted };
}

/** Deny by token. Records the decision, posts nothing, rebuilds nothing. */
export function denyMessage(db: Database.Database, token: string, nowIso: string): Message | null {
  return claimMessage(db, token, 'denied', nowIso);
}

/**
 * Tell Matt a message is waiting. Both ntfy actions carry the message's own
 * single-use token, so approving from the notification needs no page at all.
 */
export async function notifyPlaylistMessage(
  db: Database.Database,
  m: { slug: string; roundId: number; videoId: string; author: string; text: string; token: string },
): Promise<void> {
  const base = appBaseUrl();
  const { roundName, leagueTitle } = reviewContext(db, m.roundId);
  const song = songFor(db, m.roundId, m.videoId);
  await notify(db, {
    alertType: 'playlist_message',
    title: leagueTitle,
    message: roundName,
    link: `${base}/p/${m.slug}/`,
    approval: {
      kind: 'playlist_message',
      token: m.token,
      approveUrl: `${base}/api/ytm/playlist-message/approve`,
      denyUrl: `${base}/api/ytm/playlist-message/deny`,
      editUrl: `${base}/p/${m.slug}/`,
      author: m.author,
      song: song ? `${song.title} — ${song.artists}` : 'a video',
      text: m.text,
    },
  });
}
