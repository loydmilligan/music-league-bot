import { MENU_HEADING, playerMenu, type MenuEntry } from './cmuMenu.js';
import type { RecapSub } from './recapSubs.js';

const CHANGE = 'Change: morning-recap unsub · morning-recap 7:30';

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

export function recapLine(sub: RecapSub): string | undefined {
  if (!sub) return undefined;
  if (!sub.subscribed) return 'Morning recap: off. Get it in your DMs: morning-recap sub';
  const t = formatTime(sub.time);
  return t ? `Morning recap: on, ${t}. ${CHANGE}` : `Morning recap: on. ${CHANGE}`;
}

export function followUpText(o: {
  lines: string[];
  sub: RecapSub;
  menu?: MenuEntry[];
  heading?: string;
}): string {
  const menu = o.menu ?? playerMenu(false);
  const heading = o.heading ?? MENU_HEADING;
  const blocks: string[] = [];
  if (o.lines.length > 0) blocks.push(o.lines.join('\n'));
  const recap = recapLine(o.sub);
  if (recap !== undefined) blocks.push(recap);
  blocks.push([heading, ...menu.map((e) => `• ${e.command} — ${e.oneLine}`)].join('\n'));
  return blocks.join('\n\n');
}
