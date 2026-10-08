/**
 * Turn live deadlines + player settings into dual-channel PlannedSends.
 * Music League timestamps win at send time (injected by the run script).
 */
import {
  dueDeadline,
  planPlayerSends,
  OFFSETS_MS,
  type DeadlineEvent,
  type PlannedSend,
  type PlayerChannels,
  type ReminderEvent,
} from './core.js';
import { holdUntilQuietEnds } from './quietHours.js';

export interface DeadlineInput {
  key: string;
  at: number;
  title: string;
  body: string;
  click: string | null;
}

export interface NewsInput {
  id: string;
  title: string;
  body: string;
  publishedAt: number;
  click: string | null;
}

export interface FireEvent {
  key: string;
  event: ReminderEvent;
  title: string;
  body: string;
  click: string | null;
  sendAt: number;
}

export function playersFromSettings(
  all: Record<string, {
    ntfy?: { enabled?: boolean; topic?: string | null };
    whatsapp?: { enabled?: boolean; e164?: string | null };
    events?: Partial<Record<ReminderEvent, boolean>>;
  }>,
): PlayerChannels[] {
  return Object.entries(all).map(([name, s]) => ({
    name,
    ntfyTopic: s.ntfy?.enabled && s.ntfy.topic ? s.ntfy.topic : null,
    e164: s.whatsapp?.enabled && s.whatsapp.e164 ? s.whatsapp.e164 : null,
    events: s.events ?? {},
  }));
}

export function deadlineFires(deadlines: DeadlineInput[], now: number, windowMs: number): FireEvent[] {
  const out: FireEvent[] = [];
  for (const d of deadlines) {
    for (const event of ['deadline_26h', 'deadline_4h'] as DeadlineEvent[]) {
      if (!dueDeadline(d.at, event, now, windowMs)) continue;
      const hours = event === 'deadline_26h' ? '26 hours' : '4 hours';
      out.push({
        key: `${d.key}:${event}`,
        event,
        title: d.title,
        body: `${hours} — ${d.body}`,
        click: d.click,
        sendAt: holdUntilQuietEnds(d.at - OFFSETS_MS[event]),
      });
    }
  }
  return out;
}

/** News is keyed per post so a missed 15-minute tick still delivers within a day. */
export function newsFires(items: NewsInput[], now: number, windowMs = 24 * 3_600_000): FireEvent[] {
  const out: FireEvent[] = [];
  for (const item of items) {
    const sendAt = holdUntilQuietEnds(item.publishedAt);
    if (now < sendAt || now >= sendAt + windowMs) continue;
    out.push({
      key: `news:${item.id}`,
      event: 'news',
      title: item.title,
      body: item.body,
      click: item.click,
      sendAt,
    });
  }
  return out;
}

export function collectDueSends(opts: {
  players: PlayerChannels[];
  fires: FireEvent[];
  alreadySent: Set<string>;
}): PlannedSend[] {
  const out: PlannedSend[] = [];
  for (const fire of opts.fires) {
    for (const player of opts.players) {
      out.push(...planPlayerSends({
        player,
        event: fire.event,
        key: fire.key,
        title: fire.title,
        body: fire.body,
        click: fire.click,
        sendAt: fire.sendAt,
        alreadySent: opts.alreadySent,
      }));
    }
  }
  return out;
}
