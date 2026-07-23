import type { Exposure } from './types.js';

export function exposureLabel(e: Exposure): string {
  if (!e.recognizable) return 'No one in this league saw this';
  const names = e.seenBy.map((p) => p.name);
  const list =
    names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  return `${list} would recognize this`;
}
