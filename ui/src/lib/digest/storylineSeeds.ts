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
		{
			// The accommodating commissioner: perpetual extensions, no-pressure
			// vote reminders, and "peace and love."
			player: 'KarBen',
			motif: 'extensions & peace and love',
			patterns: [
				/\bno worries\b/i,
				/\b(hours?|days?|time) left to vote\b/i,
				/\bextend(ed|ing)?\b/i,
				/\bextension\b/i,
				/\bno (rush|pressure)\b/i,
				/\bpeace and love\b/i,
			],
			sources: ['chat', 'vote_comments'],
		},
		{
			// The compulsive punster. Seeded on the pun angle ONLY — the tela note
			// flags his home-chemist/psychonaut material as sensitive; do not add it.
			// Stored competitor name is lowercase `mrklorox`.
			player: 'mrklorox',
			motif: 'compulsive punster',
			patterns: [
				/\bmore like\b/i,
				/\bno egrets\b/i,
				/\bpun(s|ny|ster)?\b/i,
				/\bwordplay\b/i,
				/\balliterat/i,
			],
			sources: ['chat', 'vote_comments'],
		},
		{
			// Libby/Cherry — underground global-electronic DJ. Stored as `Cherry`.
			player: 'Cherry',
			motif: 'underground global-electronic DJ',
			patterns: [
				/\bunderground\b/i,
				/\belectronic\b/i,
				/\bgqom\b/i,
				/\bbollywood\b/i,
				/\bmy (set|sets)\b/i,
				/\bpodcast\b/i,
				/\b(middle east|south asia|african?)\b/i,
			],
			sources: ['chat', 'vote_comments'],
		},
		{
			// The obsessive over-researcher: giant "research playlists," too much homework.
			player: 'nateoeb',
			motif: 'over-researches every pick',
			patterns: [
				/\bresearch\b/i,
				/\bhyper.?focus/i,
				/\bhomework\b/i,
				/\btoo much\b.*\b(research|homework)\b/i,
			],
			sources: ['chat', 'vote_comments'],
		},
		{
			// good.golly.ms — rap-lyric tattoo sleeve (esp. Aesop Rock) + Idaho pride.
			// Stored competitor name is `GoodGollyMiss`.
			player: 'GoodGollyMiss',
			motif: 'rap-lyric tattoo sleeve (+ Idaho pride)',
			patterns: [
				/\btattoo\b/i,
				/\bsleeve\b/i,
				/\baes(op)?\b/i,
				/\bidaho\b/i,
				/\bpotato/i,
			],
			sources: ['chat', 'vote_comments'],
		},
		{
			// Lexa Prole — the Playlist President in full whimsy mode.
			player: 'Lexa Prole',
			motif: 'full whimsy mode',
			patterns: [
				/\bwhimsy\b/i,
				/\bwhimsical\b/i,
				/\bzan(y|iness)\b/i,
				/\bchaos\b/i,
				/\bplaylist president/i,
			],
			sources: ['chat', 'vote_comments'],
		},
		{
			// Mouse Atreides — sad-song evangelist with a buzzing brain to soothe.
			player: 'Mouse Atreides',
			motif: 'sad-song evangelist',
			patterns: [
				/\bsad ?(boi|boy|songs?)\b/i,
				/\bcry\b/i,
				/\bdepress/i,
				/\bbrain ?pan\b/i,
				/\badhd\b/i,
			],
			sources: ['chat', 'vote_comments'],
		},
		{
			// Tragically Skip — the chronic self-doubter (and proud dad).
			player: 'Tragically Skip',
			motif: 'never confident + proud dad',
			patterns: [
				/\b(not|never) confident\b/i,
				/\boverthink/i,
				/\bwhiff\b/i,
				/\bmy (son|kid)\b/i,
			],
			sources: ['chat', 'vote_comments'],
		},
		{
			// socalledbutton — the cocktail/spirits raconteur who reveres artists as gods.
			player: 'socalledbutton',
			motif: 'cocktails & artist-worship',
			patterns: [
				/\babsinthe\b/i,
				/\beverclear\b/i,
				/\b(bourbon|scotch|pastis)\b/i,
				/\bcocktail\b/i,
				/\bstan\b/i,
				/\bthe god\b/i,
			],
			sources: ['chat', 'vote_comments'],
		},
	],
};
