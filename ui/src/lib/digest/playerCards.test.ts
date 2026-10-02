import { describe, expect, it } from 'vitest';
import {
	BOARZ_S1_ROSTER,
	CARD_LEAGUE_SLUG,
	listBoarzPlayerCards,
} from './playerCardRoster.js';
import { attachPlayerCardClips, matchPlayerCard } from './playerCardRoster.js';

describe('listBoarzPlayerCards', () => {
	it('returns nothing unless this is the Boarz recap', () => {
		expect(listBoarzPlayerCards({ leagueSlug: CARD_LEAGUE_SLUG, recap: false, digestBase: 'https://digest.example' })).toEqual([]);
		expect(listBoarzPlayerCards({ leagueSlug: 'another-league', recap: true, digestBase: 'https://digest.example' })).toEqual([]);
	});

	it('emits absolute media URLs in standings order', () => {
		const cards = listBoarzPlayerCards({
			leagueSlug: CARD_LEAGUE_SLUG,
			recap: true,
			digestBase: 'https://digest.example/',
		});

		expect(cards.map((card) => card.slug)).toEqual(BOARZ_S1_ROSTER.map((player) => player.slug));
		expect(cards[0]).toMatchObject({
			rank: 1,
			points: 80,
			src: 'https://digest.example/_media/boarz-s1-cards/matt-mariani-mashew.mp4?v6',
			poster: 'https://digest.example/_media/boarz-s1-cards/matt-mariani-mashew.png?v6',
			shareImage: 'https://digest.example/_media/boarz-s1-cards/share/matt-mariani-mashew-front-back.jpg?v2',
		});
	});
});

describe('matchPlayerCard / attachPlayerCardClips', () => {
	it('matches Regulars archetype names including The Expat alias', () => {
		expect(matchPlayerCard({ name: 'The Expat', player: 'Grant / Koz' })?.slug).toBe('grant-koziol-koz');
		expect(matchPlayerCard({ name: 'Cat Man', player: 'JB' })?.slug).toBe('jon-black-jb');
		expect(matchPlayerCard({ name: 'Steiny Gump', player: 'Steiny' })?.slug).toBe('dave-steingart-steiny');
	});

	it('fills clip media onto Regulars cast without dropping authored fields', () => {
		const cards = listBoarzPlayerCards({
			leagueSlug: CARD_LEAGUE_SLUG,
			recap: true,
			digestBase: 'https://digest.example',
		});
		const next = attachPlayerCardClips(
			{ title: 'The Regulars: Assemble', cast: [{ name: 'Cat Man', player: 'JB', motif: 'names' }] },
			cards,
		) as { cast: Array<{ motif: string; clip: { src: string } }> };

		expect(next.cast[0].motif).toBe('names');
		expect(next.cast[0].clip.src).toContain('jon-black-jb.mp4');
	});
});
