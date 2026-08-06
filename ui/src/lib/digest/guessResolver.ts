export interface GuessCandidate { playerId: number; label: string }

/** Lowercase, drop emoji/punctuation to spaces, collapse whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildGuessMatcher(candidates: GuessCandidate[]): (comment: string) => number | null {
  // Precompute normalized labels, longest first so "poetry in noise" wins over "noise".
  const norms = candidates
    .map((c) => ({ playerId: c.playerId, n: norm(c.label) }))
    .filter((c) => c.n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);
  return (comment: string): number | null => {
    const hay = ` ${norm(comment)} `;
    const hits = new Set<number>();
    let firstLabelPlayer: number | null = null;
    for (const { playerId, n } of norms) {
      // Word-boundary-ish match: the normalized label surrounded by spaces.
      if (hay.includes(` ${n} `)) {
        if (firstLabelPlayer === null) firstLabelPlayer = playerId;
        hits.add(playerId);
      }
    }
    if (hits.size === 0) return null;
    if (hits.size === 1) return [...hits][0];
    // Ambiguous: multiple distinct players named. Prefer the longest-label match
    // (norms is longest-first, so firstLabelPlayer is the longest); if that longest
    // is unique to one player, take it, else null.
    return firstLabelPlayer;
  };
}
