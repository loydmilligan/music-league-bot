/** Boarz S1 animated baseball cards — recap visual payload. Not an LLM section. */
export const PLAYER_CARDS_MEDIA_BASE = 'https://digest.mattmariani.com/_media/boarz-s1-cards';
export const PLAYER_CARDS_CACHE = 'v3';

export type PlayerCardItem = {
  slug: string;
  name: string;
  hero: string;
  rank: number;
  points: number;
  src: string;
  poster: string;
};

const MEDIA = (slug: string) =>
  `${PLAYER_CARDS_MEDIA_BASE}/${slug}.mp4?${PLAYER_CARDS_CACHE}`;
const POSTER = (slug: string) =>
  `${PLAYER_CARDS_MEDIA_BASE}/${slug}.png?${PLAYER_CARDS_CACHE}`;

export const BOARZ_S1_PLAYER_CARDS: PlayerCardItem[] = [
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
].map((p) => ({ ...p, src: MEDIA(p.slug), poster: POSTER(p.slug) }));

export type PlayerCardsContent = {
  title?: string;
  note?: string;
  cards?: PlayerCardItem[];
};

export function playerCardsContent(): PlayerCardsContent {
  return {
    title: 'The Roster',
    note: 'Tap a card. Intro plays, then it flips to the stats back.',
    cards: BOARZ_S1_PLAYER_CARDS,
  };
}
