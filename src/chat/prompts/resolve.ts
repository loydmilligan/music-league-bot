/**
 * Resolve free text against a prompt's options.
 *
 * Ordered from most to least certain, and it REFUSES rather than guesses: two
 * equally-good candidates return `ambiguous` so the bot can ask. Every rule here
 * was derived from 2,945 real Boarz chat messages — see BLOCKED_TOKENS.
 */
import type { PromptOption, Resolution } from './types.js';

/**
 * Ordinary English words that sit within one edit of a real roster name. Scanning
 * real chat, "have" resolved to Dave 173 times, "back" to Black 26, "share" to
 * Shane 8, "giant" to Grant 6. These are excluded from the FUZZY and PREFIX
 * passes only — an exact match still wins, so an option genuinely labelled
 * "Have" would still resolve.
 */
const BLOCKED_TOKENS = new Set([
  'have', 'gave', 'cave', 'date', 'dare', 'dave',
  'back', 'lack', 'black', 'blank', 'hack', 'pack', 'rack',
  'share', 'shame', 'shake', 'shape', 'chase',
  'giant', 'grand', 'grant', 'brant',
  'honor', 'color', 'colour', 'cover',
  'comment', 'comments', 'moment', 'moments',
  'pallet', 'pallets', 'palette',
  'join', 'math', 'mall',
  'want', 'went', 'wont', 'cant', 'dont', 'than', 'that', 'them', 'then',
  'this', 'these', 'those', 'there', 'their', 'here', 'what', 'when', 'were',
]);

const MIN_FUZZY_TOKEN = 4;
const MIN_PREFIX = 4;

export interface ResolveOptions {
  /** Extra words to exclude from fuzzy/prefix matching. */
  blockedTokens?: Iterable<string>;
  /** Skip the fuzzy pass entirely — useful once aliases are well curated. */
  disableFuzzy?: boolean;
}

export function resolveAnswer(
  text: string,
  options: PromptOption[],
  opts: ResolveOptions = {},
): Resolution {
  const blocked = new Set(BLOCKED_TOKENS);
  for (const t of opts.blockedTokens ?? []) blocked.add(norm(t));
  // A word that IS part of an option's label can never be "innocent" here —
  // blocking it would only disable matching for a legitimate name ("dave",
  // "grant", "black" are all common-word collisions AND real roster words).
  for (const o of options) for (const part of labelParts(o)) blocked.delete(part);

  const t = norm(text);
  if (!t || options.length === 0) return { kind: 'unmatched' };
  const tokens = t.split(' ').filter(Boolean);

  // 1. Curated aliases. Explicit data beats every heuristic below.
  for (const o of options)
    for (const alias of o.aliases ?? [])
      if (tokens.includes(norm(alias))) return { kind: 'matched', option: o, via: `alias "${alias}"` };

  // 2. The whole label, verbatim.
  for (const o of options)
    if (norm(o.label).length > 0 && t.includes(norm(o.label)))
      return { kind: 'matched', option: o, via: 'full label' };

  // 3. Exact match on any word of a label ("Koziol" → "Grant Koziol").
  const exact = new Set<PromptOption>();
  for (const o of options)
    for (const part of labelParts(o))
      if (tokens.includes(part)) exact.add(o);
  if (exact.size === 1) return { kind: 'matched', option: first(exact), via: 'label word' };
  if (exact.size > 1) {
    // "dave j" — a bare first word plus an initial separates the two Daves.
    const narrowed = [...exact].filter((o) => {
      const parts = labelParts(o);
      return parts.some((p, i) => i > 0 && tokens.some((tk) => tk !== parts[0] && p.startsWith(tk)));
    });
    if (narrowed.length === 1) return { kind: 'matched', option: narrowed[0], via: 'word + initial' };
    return { kind: 'ambiguous', options: [...exact] };
  }

  // 4. Concatenations: "shanefarkas".
  const inside = new Set<PromptOption>();
  for (const o of options)
    for (const part of labelParts(o))
      if (
        part.length >= MIN_PREFIX &&
        !blocked.has(part) &&
        tokens.some((tk) => tk.length > part.length && !blocked.has(tk) && tk.includes(part))
      )
        inside.add(o);
  if (inside.size === 1) return { kind: 'matched', option: first(inside), via: 'label inside word' };
  if (inside.size > 1) return { kind: 'ambiguous', options: [...inside] };

  // 5. Derivations: "farkle", "farkwad", "farkface" share a prefix with Farkas
  //    but are 2-4 edits away, so edit distance never sees them.
  const pre = new Set<PromptOption>();
  for (const o of options)
    for (const part of labelParts(o)) {
      if (part.length < MIN_PREFIX || blocked.has(part)) continue;
      for (const tk of tokens) {
        if (tk.length < MIN_PREFIX || blocked.has(tk)) continue;
        if (sharedPrefix(tk, part) >= MIN_PREFIX) pre.add(o);
      }
    }
  if (pre.size === 1) return { kind: 'matched', option: first(pre), via: 'shared prefix' };
  if (pre.size > 1) return { kind: 'ambiguous', options: [...pre] };

  // 6. Typos. Budget scales with length: two edits on a four-letter word is a
  //    different word ("mara"→"matt", "lol"→"jon"), so short tokens get one.
  if (!opts.disableFuzzy) {
    const scored: Array<{ o: PromptOption; d: number }> = [];
    for (const o of options) {
      let best = Infinity;
      for (const part of labelParts(o)) {
        if (part.length < MIN_FUZZY_TOKEN || blocked.has(part)) continue;
        for (const tk of tokens) {
          if (tk.length < MIN_FUZZY_TOKEN || blocked.has(tk)) continue;
          const d = levenshtein(tk, part);
          if (d <= (tk.length >= 7 ? 2 : 1)) best = Math.min(best, d);
        }
      }
      if (best !== Infinity) scored.push({ o, d: best });
    }
    if (scored.length) {
      scored.sort((a, b) => a.d - b.d);
      const top = scored.filter((s) => s.d === scored[0].d);
      if (top.length === 1) return { kind: 'matched', option: top[0].o, via: `fuzzy d=${top[0].d}` };
      return { kind: 'ambiguous', options: top.map((s) => s.o) };
    }
  }

  return { kind: 'unmatched' };
}

function labelParts(o: PromptOption): string[] {
  return norm(o.label).split(' ').filter(Boolean);
}

function first<T>(s: Set<T>): T {
  return s.values().next().value as T;
}

function norm(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev.splice(0, prev.length, ...cur);
  }
  return prev[b.length];
}
