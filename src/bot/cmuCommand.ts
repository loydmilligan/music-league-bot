/**
 * Parses the text of an @-mention of the bot into a catch-me-up command.
 * Pure: no I/O. Returns null when the text is not a command, so the message
 * continues down the other paths (Jev, prompt answers, song capture).
 */

export type CmuCommand =
  | { kind: 'catchup' }
  | { kind: 'full' }
  | { kind: 'forget'; target: 'self' | 'all' | { id: string } }
  | { kind: 'help' };

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
  if (space > 0 && withinOneEdit(text.slice(0, space), 'catch')) {
    const rest = text.slice(space + 1);
    return ['me up', 'up'].some((p) => rest === p || rest.startsWith(p + ' '));
  }
  return false;
}

export function parseCmuCommand(
  body: string,
  mentionsBot: boolean,
  mentionedIds: string[],
  selfIds: Set<string>,
): CmuCommand | null {
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

  if (EXACT_PHRASES.includes(text) || matchesPrefixPhrase(text)) return { kind: 'catchup' };
  return null;
}
