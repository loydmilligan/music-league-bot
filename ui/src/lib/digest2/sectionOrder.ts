/**
 * Render order of the Digest view. "What's up next" (nextRound, the red box) is
 * ALWAYS last — Matt's rule (2026-10-02). The page iterates this list, so reorder
 * here, never in the template.
 */
export type Digest2SectionKey =
	| 'story'
	| 'ama'
	| 'ballot'
	| 'villain'
	| 'ballotGrid'
	| 'coinage'
	| 'standings'
	| 'tastemaker'
	| 'guesser'
	| 'reel'
	| 'statsTeaser'
	| 'nextRound';

export const DIGEST2_SECTION_ORDER: readonly Digest2SectionKey[] = [
	'story',
	'ama',
	'ballot',
	'villain',
	'ballotGrid',
	'coinage',
	'standings',
	'tastemaker',
	'guesser',
	'reel',
	'statsTeaser',
	'nextRound'
];
