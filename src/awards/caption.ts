import type { AwardDef, AwardRound, AwardsConfig } from './types.js';

/** The award and digest links for a published round's slug. */
export function awardLinks(config: AwardsConfig, def: AwardDef, slug: string): { award: string; digest: string } {
  const base = config.digestBaseUrl.replace(/\/+$/, '');
  return {
    award: `${base}/d2/${slug}/?view=awards&src=award#award-${def.key}`,
    digest: `${base}/d2/${slug}/?src=award`,
  };
}

/** Tag a real recap URL with ?src=award; a placeholder (preview) is left alone. */
const recapLink = (u: string): string => (/^https?:\/\//.test(u) ? `${u}${u.includes('?') ? '&' : '?'}src=award` : u);

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
    ...(links.recap ? [`☀️ This morning's recap: ${recapLink(links.recap)}`] : []),
    `📰 This round's digest: ${links.digest}`,
  ].join('\n');
}
