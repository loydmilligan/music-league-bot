// Boarz S1 baseball-card roster + Regulars clip matching. No filesystem —
// safe to import from client components.

export const CARD_MEDIA_VERSION = '6';

export type PlayerCardMedia = {
  slug: string;
  name: string;
  hero: string;
  rank: number;
  points: number;
  src: string;
  poster: string;
  /** Shareable front+back composite still, served from the same static host. */
  shareImage: string;
};

export type RosterEntry = Omit<PlayerCardMedia, 'src' | 'poster' | 'shareImage'>;

/** Final S1 order (penalty-aware): Matt 80 / Jon 77 / Jimmy 65 / … / Conor 8. */
export const BOARZ_S1_ROSTER: readonly RosterEntry[] = [
  { slug: 'matt-mariani-mashew', name: 'Matt Mariani', hero: 'The Slopulist', rank: 1, points: 80 },
  { slug: 'jon-black-jb', name: 'Jon Black', hero: 'Cat Man', rank: 2, points: 77 },
  { slug: 'jimmy-troy', name: 'Jimmy Troy', hero: 'The Bystander', rank: 3, points: 65 },
  { slug: 'clements-johnson-clem', name: 'Clements Johnson', hero: 'The City Bumpkin', rank: 4, points: 64 },
  { slug: 'dave-jensen-jensen', name: 'Dave Jensen', hero: 'The Concussionist', rank: 5, points: 59 },
  { slug: 'darren-paletz-dp', name: 'Darren Paletz', hero: 'The Transient', rank: 6, points: 56 },
  { slug: 'shane-farkas-uncle-shane', name: 'Shane Farkas', hero: 'The Southern Stan', rank: 7, points: 43 },
  { slug: 'dave-steingart-steiny', name: 'Dave Steingart', hero: 'Steiny Gump', rank: 8, points: 38 },
  { slug: 'grant-koziol-koz', name: 'Grant Koziol', hero: 'The Ex-Expat', rank: 9, points: 31 },
  { slug: 'conor-johnston-cj-wookie', name: 'Conor Johnston', hero: 'The Twinkler', rank: 10, points: 8 },
];

const ALIASES: Record<string, string[]> = {
  'matt-mariani-mashew': ['mashew', 'slopulist'],
  'jon-black-jb': ['jb', 'cat man'],
  'jimmy-troy': ['bystander'],
  'clements-johnson-clem': ['clem', 'city bumpkin'],
  'dave-jensen-jensen': ['jensen', 'concussionist'],
  'darren-paletz-dp': ['transient', 'paletz'],
  'shane-farkas-uncle-shane': ['shane', 'southern stan'],
  'dave-steingart-steiny': ['steiny', 'steiny gump'],
  'grant-koziol-koz': ['the expat', 'koz', 'koziol'],
  'conor-johnston-cj-wookie': ['conor', 'twinkler', 'wookie'],
};

function haystack(member: { name?: unknown; player?: unknown }): string {
  return `${member.name ?? ''} ${member.player ?? ''}`.toLowerCase();
}

export function matchPlayerCard(member: { name?: unknown; player?: unknown }): RosterEntry | undefined {
  const hay = haystack(member);
  if (!hay.trim()) return undefined;
  for (const row of BOARZ_S1_ROSTER) {
    const tokens = [row.name.toLowerCase(), row.hero.toLowerCase(), ...(ALIASES[row.slug] ?? [])];
    if (tokens.some((t) => t && hay.includes(t))) return row;
  }
  return undefined;
}

/** Only this league has rendered baseball-card media. */
export const CARD_LEAGUE_SLUG = 'boarz-ii-men';
const CARD_MEDIA_PATH = '_media/boarz-s1-cards';

/**
 * Roster mapped to its card clips, but only for the Boarz S1 season recap —
 * empty for every other league or a non-recap round, since the media exists
 * for no one else. `digestBase` is the public digest origin (no trailing
 * slash needed); the same static server ignores the cache-busting query.
 */
export function listBoarzPlayerCards(opts: {
  leagueSlug?: string | null;
  recap: boolean;
  digestBase: string;
}): PlayerCardMedia[] {
  if (!opts.recap || opts.leagueSlug !== CARD_LEAGUE_SLUG) return [];
  const base = opts.digestBase.replace(/\/+$/, '');
  return BOARZ_S1_ROSTER.map((r) => ({
    ...r,
    src: `${base}/${CARD_MEDIA_PATH}/${r.slug}.mp4?v${CARD_MEDIA_VERSION}`,
    poster: `${base}/${CARD_MEDIA_PATH}/${r.slug}.png?v${CARD_MEDIA_VERSION}`,
    shareImage: `${base}/${CARD_MEDIA_PATH}/share/${r.slug}-front-back.jpg?v2`,
  }));
}

export function attachPlayerCardClips(content: unknown, cards: PlayerCardMedia[]): unknown {
  if (!content || typeof content !== 'object') return content;
  const c = content as { cast?: Array<Record<string, unknown>> };
  if (!Array.isArray(c.cast) || !cards.length) return content;
  const bySlug = new Map(cards.map((card) => [card.slug, card]));
  return {
    ...c,
    cast: c.cast.map((member) => {
      const row = matchPlayerCard(member);
      const card = row ? bySlug.get(row.slug) : undefined;
      if (!card) return member;
      return {
        ...member,
        clip: {
          src: card.src,
          poster: card.poster,
          shareImage: card.shareImage,
          alt: `${card.name} as ${card.hero}`,
          caption: `${card.name} · ${card.hero}`,
        },
      };
    }),
  };
}
