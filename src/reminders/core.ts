/**
 * Dual-channel reminder planner. Music League live data wins at send time.
 * Offsets: 26h and 4h before a deadline. No automatic ntfy↔WhatsApp fallback.
 */
import { holdUntilQuietEnds } from './quietHours.js';
import { resolveDmTarget } from '../whatsapp/dmGuard.js';

export const OFFSETS_MS = { deadline_26h: 26 * 3_600_000, deadline_4h: 4 * 3_600_000 } as const;
export type DeadlineEvent = keyof typeof OFFSETS_MS;
export type ReminderEvent =
  | DeadlineEvent
  | 'theme_revealed'
  | 'digest_2'
  | 'results'
  | 'polls'
  | 'news';

export interface PlayerChannels {
  name: string;
  ntfyTopic: string | null;
  e164: string | null;
  events: Partial<Record<ReminderEvent, boolean>>;
}

export interface PlannedSend {
  key: string;
  event: ReminderEvent;
  player: string;
  channel: 'ntfy' | 'whatsapp';
  target: string;
  title: string;
  body: string;
  click: string | null;
  sendAt: number;
}

export function dueDeadline(
  deadlineMs: number,
  event: DeadlineEvent,
  now: number,
  windowMs: number,
): boolean {
  const fireAt = holdUntilQuietEnds(deadlineMs - OFFSETS_MS[event]);
  return now >= fireAt && now < fireAt + windowMs && now < deadlineMs;
}

export function planPlayerSends(opts: {
  player: PlayerChannels;
  event: ReminderEvent;
  key: string;
  title: string;
  body: string;
  click: string | null;
  sendAt: number;
  alreadySent: Set<string>;
}): PlannedSend[] {
  if (opts.player.events[opts.event] === false) return [];
  const out: PlannedSend[] = [];
  if (opts.player.ntfyTopic) {
    const key = `${opts.key}:${opts.player.name}:ntfy`;
    if (!opts.alreadySent.has(key)) {
      out.push({
        key,
        event: opts.event,
        player: opts.player.name,
        channel: 'ntfy',
        target: opts.player.ntfyTopic,
        title: opts.title,
        body: opts.body,
        click: opts.click,
        sendAt: opts.sendAt,
      });
    }
  }
  const dm = resolveDmTarget(opts.player.e164);
  if (dm.action === 'send') {
    const key = `${opts.key}:${opts.player.name}:whatsapp`;
    if (!opts.alreadySent.has(key)) {
      out.push({
        key,
        event: opts.event,
        player: opts.player.name,
        channel: 'whatsapp',
        target: dm.target,
        title: opts.title,
        body: opts.body,
        click: opts.click,
        sendAt: opts.sendAt,
      });
    }
  }
  return out;
}

export function skipIfDone(waiting: string[] | undefined, playerName: string): boolean {
  if (!waiting) return false;
  const wanted = playerName.toLocaleLowerCase('en-US');
  return !waiting.some((name) => name.toLocaleLowerCase('en-US') === wanted);
}
