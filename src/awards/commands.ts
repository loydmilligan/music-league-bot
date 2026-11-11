export type AwardCmd =
  | { award: string; kind: 'flag' }
  | { award: string; kind: 'list' }
  | { award: string; kind: 'pick'; place: 1 | 2 | 3; n: number }
  | { award: string; kind: 'choose'; n: number }
  | { award: string; kind: 'poster' }
  | { award: string; kind: 'kit' }
  | { award: string; kind: 'redo'; comment: string | null }
  | { award: string; kind: 'test'; action: 'on' | 'off' | 'reset' | 'status' }
  | { award: string | null; kind: 'approve' };

const PLACE_WORDS: Record<string, 1 | 2 | 3> = {
  '1': 1, '1st': 1, first: 1,
  '2': 2, '2nd': 2, second: 2,
  '3': 3, '3rd': 3, third: 3,
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a DM as an award command. Whole text must match (trimmed, case-insensitive).
 * `award` in the result is the matched configured prefix, lowercased.
 */
export function parseAwardCommand(text: string, prefixes: string[]): AwardCmd | null {
  const t = text.trim().toLowerCase();
  if (t === 'approve') return { award: null, kind: 'approve' };
  if (prefixes.length === 0) return null;

  const redoAlt = [...prefixes].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const redo = new RegExp(`^(${redoAlt})\\s+redo(?:\\s+([\\s\\S]+))?$`, 'i').exec(text.trim());
  if (redo) return { award: redo[1].toLowerCase(), kind: 'redo', comment: redo[2]?.trim() || null };
  const test = new RegExp(`^(${redoAlt})\\s+test(?:\\s+(on|off|reset))?$`, 'i').exec(text.trim());
  if (test) return { award: test[1].toLowerCase(), kind: 'test', action: (test[2]?.toLowerCase() as 'on' | 'off' | 'reset' | undefined) ?? 'status' };

  const alt = [...prefixes].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const m = new RegExp(`^(${alt})(?:(-(1st|1|first|2nd|2|second|3rd|3|third)\\s+(\\d+))|\\s+(candidates|poster|kit|approve|\\d+)|)$`).exec(t);
  if (!m) return null;

  const award = m[1];
  if (m[2] !== undefined) {
    return { award, kind: 'pick', place: PLACE_WORDS[m[3]], n: Number(m[4]) };
  }
  const tail = m[5];
  if (tail === undefined) return { award, kind: 'flag' };
  if (tail === 'candidates') return { award, kind: 'list' };
  if (tail === 'poster') return { award, kind: 'poster' };
  if (tail === 'kit') return { award, kind: 'kit' };
  if (tail === 'approve') return { award, kind: 'approve' };
  return { award, kind: 'choose', n: Number(tail) };
}
