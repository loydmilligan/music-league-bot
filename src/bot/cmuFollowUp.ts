import { MENU_HEADING, playerMenu, type MenuEntry } from './cmuMenu.js';
import type { RecapSub } from './recapSubs.js';

const CHANGE = 'Change: morning-recap unsub · morning-recap 7:30';
/** Sprint 4 (framing only): the Morning Brief words. */
const BRIEF_CHANGE = 'Change: morning-brief unsub · morning-brief 7:30';

/** "07:30" → "7:30 AM"; undefined when not HH:MM. */
export function formatTime(time: string | undefined): string | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/** `briefWords` (framing only) says Morning Brief / morning-brief; otherwise today's words. */
export function recapLine(sub: RecapSub, briefWords = false): string | undefined {
  if (!sub) return undefined;
  const label = briefWords ? 'Morning Brief' : 'Morning recap';
  const cmd = briefWords ? 'morning-brief' : 'morning-recap';
  const change = briefWords ? BRIEF_CHANGE : CHANGE;
  if (!sub.subscribed) return `${label}: off. Get it in your DMs: ${cmd} sub`;
  const t = formatTime(sub.time);
  return t ? `${label}: on, ${t}. ${change}` : `${label}: on. ${change}`;
}

const LA_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
});

/** The Recap's fact line: `last 7 days · to HH:MM` (24 h, LA) at `at` (an ISO time; invalid → now). */
export function recapFact(at: string): string {
  let d = new Date(at);
  if (Number.isNaN(d.getTime())) d = new Date();
  const p = LA_HM.formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `last 7 days · to ${g('hour')}:${g('minute')}`;
}

export function followUpText(o: {
  lines: string[];
  sub: RecapSub;
  menu?: MenuEntry[];
  heading?: string;
  /** Sprint 4 (framing only): Morning Brief wording in the recap line. */
  briefWords?: boolean;
}): string {
  const menu = o.menu ?? playerMenu(false);
  const heading = o.heading ?? MENU_HEADING;
  const blocks: string[] = [];
  if (o.lines.length > 0) blocks.push(o.lines.join('\n'));
  const recap = recapLine(o.sub, o.briefWords === true);
  if (recap !== undefined) blocks.push(recap);
  blocks.push([heading, ...menu.map((e) => `• ${e.command} — ${e.oneLine}`)].join('\n'));
  return blocks.join('\n\n');
}
