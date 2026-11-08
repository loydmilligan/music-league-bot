// Pure formatter: every bot DM gets the same name/facts/body/divider/footer frame.

export const FRAME_DIVIDER = '──────────';

export const MESSAGE_NAMES = {
  catchup: 'Catchup',
  quiet: 'Not Much Happened',
  recap: 'Recap',
  help: 'Help',
  forget: 'Forget',
  botOff: 'Bot Off',
  botOn: 'Bot On',
  botCalls: 'Bot Calls',
  morningBrief: 'Morning Brief',
  morningBriefSettings: 'Morning Brief Settings',
  wrongPlace: 'Wrong Place',
  topSongs: 'Top Songs',
  topPics: 'Top Pics',
  topVideos: 'Top Videos',
  topLinks: 'Top Links',
  topMedia: 'Top Media',
  topics: 'Topics',
  topic: (n: number): string => `Topic ${n}`,
  pickOne: 'Pick One',
  dossier: 'My Dossier',
} as const;

export const FOOTER_RETRY = 'Try again in a minute.';

/** Framed failures carry FOOTER_RETRY, so a trailing "Try again ..." sentence in the body is dropped. */
export function withoutRetry(body: string): string {
  return body.replace(/\s*Try again[^.]*\.\s*$/, '');
}
export const FOOTER_RECAP =
  'Comes with your first catch-up of the day. Any time: DM recap7 for the last 7 days.';
export const FOOTER_HELP =
  'Group commands: @bot <command> in the group. DM commands: message me directly.';
export const FOOTER_OWNER = 'DM me "help" for owner commands.';
export const FOOTER_WRONG_PLACE = 'DM me "help" for every command.';
export const FOOTER_PLAYER = 'DM me "help" for more commands.';
export const FOOTER_MORNING = 'Change it: DM morning-brief unsub · morning-brief 7:30';

export interface FrameOptions {
  name: string;
  facts?: string[];
  body: string;
  footer: string;
}

function build(name: string, facts: string[], body: string, footer?: string): string {
  const lines = [`── ${name} ──`, ...facts, body];
  if (footer !== undefined) lines.push(FRAME_DIVIDER, footer);
  return lines.join('\n');
}

export function frameMessage(o: FrameOptions): string {
  return build(o.name, o.facts ?? [], o.body, o.footer);
}

/** Frame for a media caption: drops footer (and divider), then facts; never the body. */
export function frameCaption(o: FrameOptions, max = 1024): string {
  const facts = o.facts ?? [];
  const full = build(o.name, facts, o.body, o.footer);
  if (full.length <= max) return full;
  const noFooter = build(o.name, facts, o.body);
  if (noFooter.length <= max) return noFooter;
  return build(o.name, [], o.body);
}

const LA_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function lastVisitFact(o: { windowStart?: string; windowReason?: string }): string {
  const { windowStart, windowReason } = o;
  if ((windowReason === 'last-post' || windowReason === 'last-dm') && windowStart) {
    const d = new Date(windowStart);
    if (!Number.isNaN(d.getTime())) {
      const parts = LA_FORMAT.formatToParts(d);
      const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
      return `Last Visit = ${g('month')}/${g('day')}/${g('year')} ${g('hour')}:${g('minute')}`;
    }
  }
  if (windowReason === 'capped-48h') return 'Last Visit = none (last 48 h)';
  if (windowReason === 'full-48h') return 'Last Visit = full 48 h';
  return 'Last Visit = none (last 24 h)';
}

export function dailyCountFact(o: {
  used?: number;
  limit?: number;
  full?: boolean;
}): string | undefined {
  if (o.used === undefined || o.limit === undefined) return undefined;
  return `Daily Count ${o.used} of ${o.limit}${o.full ? ' (full, not counted)' : ''}`;
}
