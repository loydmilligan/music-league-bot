import type { AwardDef, AwardRound } from './types.js';

/** The post caption. The recap line is left out when there is no recap. */
export function buildCaption(
  def: AwardDef,
  r: AwardRound,
  links: { award: string; recap: string | null; digest: string },
): string {
  const who = ([1, 2, 3] as const).map((p) => r.candidates.find((c) => c.n === r.picks[p])?.who ?? '?');
  return [
    `🏆 ${def.name}`,
    `🥇 ${who[0]} · 🥈 ${who[1]} · 🥉 ${who[2]}`,
    `👉 Full award: ${links.award}`,
    ...(links.recap ? [`☀️ This morning's recap: ${links.recap}`] : []),
    `📰 This round's digest: ${links.digest}`,
  ].join('\n');
}
