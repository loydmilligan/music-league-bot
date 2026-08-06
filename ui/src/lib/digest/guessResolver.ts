export interface GuessCandidate { playerId: number; label: string }

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

export function buildGuessMatcher(candidates: GuessCandidate[]): (comment: string) => number | null {
  // Precompute despaced/de-punctuated keys, preserving original candidate order for tie-breaks.
  const entries = candidates
    .map((c, idx) => ({ playerId: c.playerId, key: lettersOnly(c.label), idx }))
    .filter((e) => e.key.length >= 3);

  return (comment: string): number | null => {
    const tokens = comment.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

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
          key.length >= 5 &&
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
