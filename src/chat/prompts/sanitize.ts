/**
 * Turn a raw chat message into the bare text an answer resolver should see.
 *
 * Independent of what is being asked. The relay-prefix rule below is not a
 * nicety: WhatsApp notification relays render a quote-reply as
 * "Matt Mariani: Koziol", and matching that raw string resolved to *Matt
 * Mariani* — the person answering — rather than their answer, via the
 * highest-confidence route. Silent, systematic misattribution of every reply.
 */

/** Conversational lead-ins that carry no answer content. */
const LEAD_INS = [
  'i think', 'i reckon', 'i say', 'i guess', 'my guess is', 'gotta be', 'has to be',
  'must be', 'thats', "that's", 'its', "it's", 'probably', 'definitely', 'maybe',
  'im going', "i'm going", 'going with', 'ill say', "i'll say", 'answer', 'is',
];

export interface SanitizeOptions {
  /** Bare word, no '#'. When present, "#word rest" yields "rest". */
  hashtag?: string;
  /** Cap on the returned text; answers are short, essays are not answers. */
  maxLength?: number;
}

export interface SanitizeResult {
  text: string;
  /** True when the hashtag was present and stripped. */
  usedHashtag: boolean;
  /** True when a "Sender Name: " relay prefix was removed. */
  strippedPrefix: boolean;
}

/**
 * A leading "Some Name: " added by a notification relay, not typed by a human.
 * Requires a short, capitalised, name-shaped run so real speech like
 * "honestly: it's Grant" or a URL's "https://" is left alone.
 */
const RELAY_PREFIX = /^([A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){0,3}):\s+(?=\S)/u;

export function sanitizeAnswer(raw: string, opts: SanitizeOptions = {}): SanitizeResult {
  const maxLength = opts.maxLength ?? 120;
  let text = (raw ?? '').replace(/ /g, ' ').trim();
  let strippedPrefix = false;
  let usedHashtag = false;

  // Relay prefix first — it sits outside everything else.
  const prefixed = RELAY_PREFIX.exec(text);
  if (prefixed && !/^https?$/i.test(prefixed[1])) {
    text = text.slice(prefixed[0].length).trim();
    strippedPrefix = true;
  }

  if (opts.hashtag) {
    const tag = new RegExp(`(^|\\s)#${escapeRegExp(opts.hashtag)}\\b`, 'iu');
    if (tag.test(text)) {
      usedHashtag = true;
      text = text.replace(tag, ' ').trim();
    }
  }

  // Strip lead-ins repeatedly: "i think it's Grant" sheds two.
  let changed = true;
  while (changed) {
    changed = false;
    const lower = text.toLowerCase();
    for (const lead of LEAD_INS) {
      if (lower.startsWith(`${lead} `)) {
        text = text.slice(lead.length + 1).trim();
        changed = true;
        break;
      }
    }
  }

  // Trailing/leading punctuation and wrapping quotes, but never internal ones —
  // "Jon-Paul" and "O'Brien" must survive intact.
  text = text.replace(/^["'“”‘’(\[\s]+/u, '').replace(/["'“”‘’)\]\s.,!?]+$/u, '').trim();
  text = text.replace(/\s+/g, ' ');
  if (text.length > maxLength) text = text.slice(0, maxLength).trim();

  return { text, usedHashtag, strippedPrefix };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
