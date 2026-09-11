import { COMMON_WORDS_RAW, LONG_WORDS_RAW } from './wordLists.js';

export interface GuessCandidate {
  playerId: number;
  label: string;
  /**
   * Allow a label shorter than the 3-character floor (min 2).
   *
   * Auto-derived candidates — competitor names, identity handles — never opt in:
   * a 2-character key off a name we didn't choose collides with ordinary words.
   * A hand-curated league alias is different, because someone decided it means a
   * person here. "JB" is the case that forced this: it is how Jon Black is
   * referred to in Boarz, and dropping it silently cost two resolutions across
   * three rounds, one of them a correct guess.
   */
  allowShort?: boolean;
  /**
   * Match this label verbatim only — never at edit-distance 1.
   *
   * The fuzzy rule exists so a typo'd nickname still resolves, and it refuses to
   * fuzz a run that is a real English word. But the word list holds the 10k most
   * common words, and a coined nickname is usually one edit from something that
   * is a word to a human and absent from that list. Every case so far is a
   * hand-curated alias: "Koshel" reaches "kosher", "Conie" reaches the "Con Te"
   * of Con Te Partirò, "Stein" reaches "stain". A nickname someone chose should
   * resolve when it is written, not when something else is.
   */
  exactOnly?: boolean;
}

/** Lowercase, strip everything but letters/digits — fully despaced/de-punctuated. */
function lettersOnly(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Standard bounded Levenshtein distance (small strings only; no early-exit needed here). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

const MAX_RUN_TOKENS = 4;

/**
 * Ordinary English words are never fuzzy-matched to a name.
 *
 * The edit-distance-1 rule exists to survive typos in a nickname, but it also
 * turns any real word one letter away from a roster name INTO that name. Real
 * case: "See Kevin and bean rant from chat" — plain vote commentary, no guess in
 * it — scored as a guess of Grant, because "rant" is one insertion from "Grant".
 * It then counted as a wrong guess against Jensen and dragged his rate down.
 *
 * Same failure the chat resolver's BLOCKED_TOKENS was built from ("have" -> Dave
 * 173 times), so the same remedy: a word that exists in English has to match a
 * candidate EXACTLY to count. Exact matches are unaffected, so a nickname that
 * happens to be a word ("Cozy", "Clem") still resolves when actually written.
 *
 * The word list alone is not enough — it holds the 10k most common words and
 * "rant" is not among them — so fuzzy also requires the TYPED run to be 5+
 * characters. Previously only the candidate had to be; a 4-letter word could
 * reach a 5-letter name, which is exactly how "rant" became "Grant" and how
 * "have" would become "Dave".
 */
let COMMON: Set<string> | null = null;
function isEnglishWord(w: string): boolean {
  if (COMMON === null) {
    COMMON = new Set(
      (COMMON_WORDS_RAW + '\n' + LONG_WORDS_RAW)
        .split('\n')
        .map((x) => x.trim().toLowerCase())
        .filter((x) => x.length > 0),
    );
  }
  return COMMON.has(w);
}

export function buildGuessMatcher(candidates: GuessCandidate[]): (comment: string) => number | null {
  // Precompute despaced/de-punctuated keys, preserving original candidate order for tie-breaks.
  const entries = candidates
    .map((c, idx) => ({
      playerId: c.playerId,
      key: lettersOnly(c.label),
      idx,
      min: c.allowShort ? 2 : 3,
      exactOnly: !!c.exactOnly,
    }))
    .filter((e) => e.key.length >= e.min);

  return (comment: string): number | null => {
    // Drop a possessive 's BEFORE despacing, because despacing destroys the
    // only signal that separates the two. In Second Best "Sarah S" is Sarah
    // Black's roster name and "Sarah's" is Sarah Zucker's possessive, and both
    // despace to "sarahs" — so an unstripped possessive credits the guess to
    // the wrong Sarah.
    const tokens = comment
      .toLowerCase()
      .replace(/([a-z0-9])['’]s\b/g, '$1')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    // Build all consecutive word-run keys (1..4 tokens), preserving word boundaries.
    const runKeys: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      let run = '';
      for (let n = 1; n <= MAX_RUN_TOKENS && i + n <= tokens.length; n++) {
        run += tokens[i + n - 1];
        runKeys.push(run);
      }
    }

    const bestByPlayer = new Map<number, { keyLen: number; idx: number }>();

    for (const runKey of runKeys) {
      for (const entry of entries) {
        const { key, playerId, idx } = entry;
        const exact = runKey === key;
        const fuzzy =
          !exact &&
          !entry.exactOnly &&
          key.length >= 5 &&
          runKey.length >= 5 &&
          !isEnglishWord(runKey) &&
          Math.abs(runKey.length - key.length) <= 1 &&
          editDistance(runKey, key) <= 1;
        if (!exact && !fuzzy) continue;

        const existing = bestByPlayer.get(playerId);
        if (!existing || key.length > existing.keyLen || (key.length === existing.keyLen && idx < existing.idx)) {
          bestByPlayer.set(playerId, { keyLen: key.length, idx });
        }
      }
    }

    if (bestByPlayer.size === 0) return null;
    if (bestByPlayer.size === 1) return [...bestByPlayer.keys()][0];

    // Ambiguous: multiple distinct players named. Longest matched label wins;
    // ties resolve by earliest candidate array order (matches prior behavior).
    let winner: number | null = null;
    let winnerBest: { keyLen: number; idx: number } | null = null;
    for (const [playerId, best] of bestByPlayer) {
      if (
        winnerBest === null ||
        best.keyLen > winnerBest.keyLen ||
        (best.keyLen === winnerBest.keyLen && best.idx < winnerBest.idx)
      ) {
        winner = playerId;
        winnerBest = best;
      }
    }
    return winner;
  };
}
