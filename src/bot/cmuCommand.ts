/**
 * Parses the text of an @-mention of the bot into a catch-me-up command.
 * Pure: no I/O. Returns null when the text is not a command, so the message
 * continues down the other paths (Jev, prompt answers, song capture).
 */

export type CmuCommand =
  | { kind: 'catchup' }
  | { kind: 'full' }
  | { kind: 'forget'; target: 'self' | 'all' | { id: string } }
  | { kind: 'help' }
  | { kind: 'off' }
  | { kind: 'on' }
  | { kind: 'tldr' }
  | { kind: 'recap' }
  // Player commands: returned only in DM mode (R1).
  | { kind: 'top'; list: TopList; days: 2 | 7 }
  | { kind: 'pick' }
  | { kind: 'topics' }
  | { kind: 'topic'; n: number }
  | { kind: 'dossier' }
  | { kind: 'recap-sub' }
  | { kind: 'recap-unsub' }
  | { kind: 'recap-time'; time: string }
  | { kind: 'recap-time-bad' };

export type TopList = 'songs' | 'pics' | 'videos' | 'links' | 'media';

/** Up to 3 of these may lead the text (spec M1). */
export const FILLER_WORDS: readonly string[] = [
  'hey', 'yo', 'bot', 'pls', 'please', 'can', 'could', 'you', 'u', 'would', 'ya', 'mind', 'just', 'quick',
];

const MAX_FILLER = 3;

/** Multi-word phrases match as a whole-word prefix; trailing text is allowed. */
const PREFIX_PHRASES: readonly string[] = [
  'catch me up', 'catch up', 'catchup', 'catchmeup', 'cmu',
  'what did i miss', "what'd i miss", 'whatd i miss', 'wdim',
  'fill me in', 'recap me',
];

/** Owner-only command words: exact match, no typo tolerance. */
const RECAP_PHRASES: readonly string[] = ['recap-bot-calls', 'recap bot calls', 'recapbotcalls'];

/** Bare words that must be the whole text (B2), so "summary of round 3" is Jev's. */
const EXACT_PHRASES: readonly string[] = ['recap', 'summary', 'summarize'];

/** Damerau edit distance (insert, delete, substitute, adjacent swap) is exactly 1. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // swap
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

function matchesPrefixPhrase(text: string): boolean {
  for (const p of PREFIX_PHRASES) {
    if (text === p || text.startsWith(p + ' ')) return true;
  }
  // Typo in the first word of a "catch ..." phrase.
  const space = text.indexOf(' ');
  const first = text.slice(0, space);
  if (space > 0 && first.startsWith('c') && withinOneEdit(first, 'catch')) {
    const rest = text.slice(space + 1);
    return ['me up', 'up'].some((p) => rest === p || rest.startsWith(p + ' '));
  }
  return false;
}

/**
 * M2: a recap time as "HH:MM" (24 h, LA). Accepts H, H:MM, HH:MM with optional am/pm.
 * No suffix: H >= 13 or H <= 4 is 24 h, 5-11 is AM, 12 is noon.
 */
export function parseRecapTime(s: string): string | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s.trim().toLowerCase());
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (min > 59) return undefined;
  if (m[3]) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
  } else if (h > 23) {
    return undefined;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** DM mode (R1/R2): the whole text must be one command; no mention, no filler. */
function parseDmCommand(body: string): CmuCommand | null {
  const text = body
    .toLowerCase()
    .replace(/’/g, "'")
    .trim()
    .replace(/[.!?,\s]+$/u, '')
    .replace(/\s+/g, ' ');

  if (text === 'help') return { kind: 'help' };
  if (RECAP_PHRASES.includes(text)) return { kind: 'recap' };

  const top = /^top[- ]?(songs|pics|videos|links|media)( week)?$/.exec(text);
  if (top) return { kind: 'top', list: top[1] as TopList, days: top[2] ? 7 : 2 };
  if (text === 'pick one' || text === 'pick-one') return { kind: 'pick' };
  if (/^list[- ]?topics$/.test(text)) return { kind: 'topics' };
  const topic = /^show[- ]?topic (\d{1,2})$/.exec(text);
  if (topic) {
    const n = Number(topic[1]);
    return n >= 1 && n <= 10 ? { kind: 'topic', n } : null;
  }
  if (text === 'dossier' || /^my[- ]?dossier$/.test(text)) return { kind: 'dossier' };

  if (text === 'recap sub') return { kind: 'recap-sub' };
  const mr = /^morning[- ]?recap (.+)$/.exec(text);
  if (mr) {
    const arg = mr[1];
    if (arg === 'sub') return { kind: 'recap-sub' };
    if (arg === 'unsub') return { kind: 'recap-unsub' };
    const time = parseRecapTime(arg.startsWith('time ') ? arg.slice(5) : arg);
    return time ? { kind: 'recap-time', time } : { kind: 'recap-time-bad' };
  }

  // Catch me up: the same phrases as the group, but exactly (no trailing text).
  if (EXACT_PHRASES.includes(text) || PREFIX_PHRASES.includes(text)) return { kind: 'catchup' };
  const space = text.indexOf(' ');
  if (space > 0 && text[0] === 'c' && withinOneEdit(text.slice(0, space), 'catch')) {
    const rest = text.slice(space + 1);
    if (rest === 'me up' || rest === 'up') return { kind: 'catchup' };
  }
  return null;
}

export function parseCmuCommand(
  body: string,
  mentionsBot: boolean,
  mentionedIds: string[],
  selfIds: Set<string>,
  opts?: { dm?: boolean },
): CmuCommand | null {
  if (opts?.dm) return parseDmCommand(body);
  if (!mentionsBot) return null;

  let text = body
    .replace(/^(\s*@\S+)+/u, '') // leading mention tokens
    .toLowerCase()
    .replace(/’/g, "'")
    .trim()
    .replace(/[.!?,\s]+$/u, '');

  for (let n = 0; n < MAX_FILLER; n++) {
    const m = /^(\S+)\s*(.*)$/su.exec(text);
    if (!m || !FILLER_WORDS.includes(m[1].replace(/[.!?,]+$/u, ''))) break;
    text = m[2];
  }
  text = text.replace(/\s+/g, ' ').trim();

  if (text === 'help') return { kind: 'help' };
  if (text === 'full') return { kind: 'full' };
  if (text === 'off') return { kind: 'off' };
  if (text === 'on') return { kind: 'on' };
  if (text === 'tldr' || text === 'tl;dr' || text === 'tl dr') return { kind: 'tldr' };
  if (text === 'forget' || text.startsWith('forget ')) {
    const arg = text.slice('forget'.length).trim();
    if (arg === '') return { kind: 'forget', target: 'self' };
    if (arg === 'all') return { kind: 'forget', target: 'all' };
    if (arg.startsWith('@')) {
      const id = mentionedIds.find((m) => !selfIds.has(m));
      return id ? { kind: 'forget', target: { id } } : null;
    }
    return null;
  }

  if (RECAP_PHRASES.includes(text)) return { kind: 'recap' };
  if (EXACT_PHRASES.includes(text) || matchesPrefixPhrase(text)) return { kind: 'catchup' };
  return null;
}
