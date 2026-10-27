import type { HeightClass } from './gating.js';

export const GLOBAL_NOTES = [
	'Glasses only where the photos show them; otherwise none.',
	'Hair matches the photos: color, amount, hairline. The head sits inside the hair edge — the bald silhouette must never poke out past the hair at the sides.',
	"Don't invent goatees, baldness, or glasses.",
].join('\n');

/** Boarz S2 heights (Mashew). Brian omitted from the 4:01 list → medium. */
export const BOARZ_HEIGHTS: Record<string, HeightClass> = {
	'ronnie-bertolina': 'short',
	'shane-farkas': 'short',
	'conor-johnston': 'short',
	'jon-black': 'medium',
	'darren-paletz': 'medium',
	'grant-koziol': 'medium',
	'brian-grushkin': 'medium',
	'matt-mariani': 'tall',
	'dave-jensen': 'tall',
	'jimmy-troy': 'tall',
	'clements-johnson': 'tallest',
};

export const DEFAULT_MEMBER_NOTES: Record<string, string> = {
	'clements-johnson': 'Not bald — full brown hair. No glasses. Barely any beard (light stubble only). Tallest of all.',
	'brian-grushkin': 'Mustache only. No goatee. No chin beard. No glasses.',
	'shane-farkas': 'Lots of dark hair, thick beard. Short. No glasses.',
	'grant-koziol': 'No glasses. Curly/wavy light-brown hair. Light stubble.',
	'dave-jensen': 'Hair, glasses, and facial hair must be accurate to the photo.',
	'ronnie-bertolina': 'From his new photo (UCLA studio portrait).',
	'conor-johnston': 'From a different base image than the pink-cap full-body. Short. No glasses.',
	'jon-black': 'From a different base image / tighter crop of the photograph. Long dark hair. Medium.',
};

export const BOARZ_PLAYER_IDS: Record<number, string> = {
	1: 'matt-mariani',
	4: 'jon-black',
	30: 'grant-koziol',
	31: 'shane-farkas',
	32: 'conor-johnston',
	34: 'dave-jensen',
	35: 'clements-johnson',
	36: 'darren-paletz',
	38: 'jimmy-troy',
	69: 'ronnie-bertolina',
	70: 'brian-grushkin',
};

export const BOARZ_LEAGUE_SLUG = 'boarz-ii-men';
export const BOARZ_SEASON_NUMBER = 2;
export const HIP_JAMMERS_LEAGUE_SLUG = 'hip-jammers';
export const HIP_JAMMERS_PLAYERS_SUB = 'hip-jammers-players';
export const SECOND_BEST_LEAGUE_SLUG = 'second-best';
export const SECOND_BEST_PLAYERS_SUB = 'second-best-players';

export function heightFor(slug: string): HeightClass {
	return BOARZ_HEIGHTS[slug] ?? 'medium';
}

export function heightLine(slug: string, height: HeightClass): string {
	if (height === 'tallest') return `${slug}: height class TALLEST of all (visibly taller than every other player).`;
	return `${slug}: height class ${height}.`;
}
