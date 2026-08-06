/**
 * storylineSeeds — the per-league cast of recurring characters the
 * Storylines digest section writes up.
 *
 * A seed names a player, a motif, and the regex patterns that count as
 * "on-topic" for that motif, plus which evidence sources to search
 * (`chat`, `vote_comments`, or both). Evidence gathering itself is
 * deterministic — see `storylineEvidence.ts` — this file is just config.
 *
 * `player` is matched against the ML competitor name / player display name
 * after normalization (lowercase, non-alphanumeric stripped), so casing and
 * spacing here don't have to match exactly what's stored.
 */

export interface StorylineSeed {
	player: string;
	motif: string;
	patterns: RegExp[];
	sources: Array<'chat' | 'vote_comments'>;
}

export const STORYLINE_SEEDS: Record<string, StorylineSeed[]> = {
	sssc: [
		{
			player: 'PoetryinNoise',
			motif: 'cats & big butts',
			patterns: [/\bcats?\b/i, /\bbig butts?\b/i, /\bbutts?\b/i],
			sources: ['vote_comments', 'chat'],
		},
		{
			player: 'Timmywhatup',
			motif: 'rap deep-dives & weed',
			patterns: [/\brap(ity)?\b/i, /\bnew (music|releases?)\b/i, /\bfriday\b/i, /\bweed\b/i],
			sources: ['chat'],
		},
		{
			player: 'bagimation',
			motif: "songs they didn't pick",
			patterns: [
				/\bdidn.?t (pick|choose|submit)\b/i,
				/\bshould have (picked|submitted)\b/i,
				/\balmost (picked|went with)\b/i,
			],
			sources: ['chat'],
		},
		{
			player: 'missmara',
			motif: "songs they didn't pick",
			patterns: [
				/\bdidn.?t (pick|choose|submit)\b/i,
				/\bshould have (picked|submitted)\b/i,
				/\balmost (picked|went with)\b/i,
			],
			sources: ['chat'],
		},
	],
};
