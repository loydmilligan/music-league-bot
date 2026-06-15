import { z } from 'zod';
import type { PredictionTask } from '../../predict/predict.js';

// ── Accent colors (restricted set per spec §7, §9) ────────────────────────────

export const ACCENT_VALUES = ['pulp', 'amber', 'sky', 'moss', 'ember'] as const;
export type AccentColor = (typeof ACCENT_VALUES)[number];
const AccentSchema = z.enum(ACCENT_VALUES);

// ── No-strife constraint (spec §9) — embedded verbatim in every LLM prompt ───
// Tests assert this text appears in message content.

export const NO_STRIFE_CONSTRAINT = `NO-STRIFE CONTRACT (hard constraints — never violate these):
- Superlatives are warm and affectionate, even when playfully teasing. Never frame anyone as a loser, worst, or last.
- No last-place language, win-loss records, worst-average, or any ranking that implies someone is at the bottom.
- KPIs are celebratory facts, never a ladder. Frame quirks and achievements, not standings.
- The "biggest hater" is a friendly, affectionate framing — the person who lovingly withholds points, never an insult.
- Every person should feel good (or warmly amused) reading their own award. These are yearbook superlatives, not roasts.`;

// ── Shared fingerprint input schema (mirrors FingerprintOutput from sprint-28) ─

const FingerprintSchema = z.object({
	signature_artists: z.array(z.string()),
	genres: z.array(z.string()),
	eras: z.array(z.string()),
	rewards: z.array(z.string()),
	punishes: z.array(z.string()),
	summary: z.string(),
	confidence: z.enum(['low', 'medium', 'high']),
});
export type NarrativeFingerprintInput = z.infer<typeof FingerprintSchema>;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PER-PLAYER SUPERLATIVES
//    Input:  player name + fingerprint + season stat
//    Output: superlatives[] + signatureSuperlative
// ═══════════════════════════════════════════════════════════════════════════════

export const SuperlativeItemSchema = z.object({
	award: z.string().min(1),
	accent: AccentSchema,
	blurb: z.string().min(1),
}).strict();
export type SuperlativeItem = z.infer<typeof SuperlativeItemSchema>;

export const SignatureSuperlativeSchema = z.object({
	award: z.string().min(1),
	blurb: z.string().min(1),
}).strict();
export type SignatureSuperlative = z.infer<typeof SignatureSuperlativeSchema>;

export const PlayerSuperlativesOutputSchema = z.object({
	superlatives: z.array(SuperlativeItemSchema).min(1).max(5),
	signatureSuperlative: SignatureSuperlativeSchema,
}).strict();
export type PlayerSuperlativesOutput = z.infer<typeof PlayerSuperlativesOutputSchema>;

const PlayerSuperlativesInputSchema = z.object({
	playerName: z.string().min(1),
	leagueName: z.string().min(1),
	fingerprint: FingerprintSchema,
	stat: z.object({
		submitted: z.number().int().nonnegative(),
		avgPts: z.number().nonnegative(),
		wins: z.number().int().nonnegative(),
	}),
});
export type PlayerSuperlativesInput = z.infer<typeof PlayerSuperlativesInputSchema>;

function buildPlayerSuperlativesMessages(
	input: PlayerSuperlativesInput,
): { role: 'system' | 'user'; content: string }[] {
	const fp = input.fingerprint;
	const stat = input.stat;

	return [
		{
			role: 'system',
			content: `You are a warm, witty music league yearbook writer for "${input.leagueName}". Your job is to write delightful superlative awards for individual league members — in the spirit of Spotify Wrapped meets high-school yearbook.

${NO_STRIFE_CONSTRAINT}

Write 2–4 superlative awards plus one signature superlative (the single best one). Each award has:
- "award": short, punchy award title (e.g. "Mayor of 1994", "The Tearjerker")
- "accent": one of pulp | amber | sky | moss | ember — choose based on vibe (pulp = bold/fun, amber = warm, sky = cool/blue, moss = earthy/dry, ember = spicy/rare)
- "blurb": 1–2 sentences, grounded in their actual taste, affectionate and specific

The signature superlative has only "award" and "blurb" (no accent field).

Output valid JSON with exactly this shape:
{
  "superlatives": [{"award": "...", "accent": "pulp|amber|sky|moss|ember", "blurb": "..."}, ...],
  "signatureSuperlative": {"award": "...", "blurb": "..."}
}`,
		},
		{
			role: 'user',
			content: `Write superlatives for ${input.playerName}.

Taste fingerprint:
- Summary: ${fp.summary}
- Signature artists: ${fp.signature_artists.join(', ')}
- Genres: ${fp.genres.join(', ')}
- Eras: ${fp.eras.join(', ')}
- Rewards (votes up): ${fp.rewards.join(', ')}
- Punishes (votes down): ${fp.punishes.join(', ')}
- Signal confidence: ${fp.confidence}

Season stats: ${stat.submitted} songs submitted · ${stat.avgPts.toFixed(1)} avg pts · ${stat.wins} round win(s)`,
		},
	];
}

const DEFAULT_MODEL = process.env.OPENROUTER_PREDICT_MODEL ?? 'anthropic/claude-sonnet-4-5';

export const playerSuperlativesTask: PredictionTask<
	PlayerSuperlativesInput,
	PlayerSuperlativesOutput
> = {
	id: 'narrative-player-superlatives',
	inputSchema: PlayerSuperlativesInputSchema,
	buildMessages: buildPlayerSuperlativesMessages,
	model: DEFAULT_MODEL,
	outputSchema: PlayerSuperlativesOutputSchema,
};

// ── Slice type for the read-model ─────────────────────────────────────────────
/** What the narrative generator contributes to a single member's read-model entry. */
export interface NarrativePlayerSlice {
	superlatives: SuperlativeItem[];
	signatureSuperlative: SignatureSuperlative;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FAN / HATER BLURBS
//    Input:  player name + biggest-fan and biggest-hater relationships (from deterministic)
//    Output: one friendly line each
// ═══════════════════════════════════════════════════════════════════════════════

export const FanHaterBlurbOutputSchema = z.object({
	fanLine: z.string().min(1),
	haterLine: z.string().min(1),
}).strict();
export type FanHaterBlurbOutput = z.infer<typeof FanHaterBlurbOutputSchema>;

const FanHaterBlurbInputSchema = z.object({
	playerName: z.string().min(1),
	leagueName: z.string().min(1),
	biggestFan: z.object({ who: z.string(), pts: z.number() }),
	biggestHater: z.object({ who: z.string(), pts: z.number() }),
});
export type FanHaterBlurbInput = z.infer<typeof FanHaterBlurbInputSchema>;

function buildFanHaterBlurbMessages(
	input: FanHaterBlurbInput,
): { role: 'system' | 'user'; content: string }[] {
	return [
		{
			role: 'system',
			content: `You are writing the "Biggest Fan" and "Friendly Hater" one-liner blurbs for a music league yearbook ("${input.leagueName}").

${NO_STRIFE_CONSTRAINT}

The "biggest fan" is the person who gave this player the most points this season — write a warm, charming line about that relationship.
The "biggest hater" is the person who most often withheld or downvoted this player's picks — frame it as an affectionate roast, never mean. Think: fond exasperation, not insult.

Each line should be 1–2 sentences, conversational, and feel like something that would get a laugh in the group chat.

Output valid JSON with exactly:
{
  "fanLine": "...",
  "haterLine": "..."
}`,
		},
		{
			role: 'user',
			content: `Write the fan and hater blurbs for ${input.playerName}.

Biggest fan: ${input.biggestFan.who} (gave ${input.biggestFan.pts} pts this season)
Biggest hater: ${input.biggestHater.who} (pts withheld / downvote score: ${input.biggestHater.pts})`,
		},
	];
}

export const fanHaterBlurbTask: PredictionTask<FanHaterBlurbInput, FanHaterBlurbOutput> = {
	id: 'narrative-fan-hater-blurbs',
	inputSchema: FanHaterBlurbInputSchema,
	buildMessages: buildFanHaterBlurbMessages,
	model: DEFAULT_MODEL,
	outputSchema: FanHaterBlurbOutputSchema,
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. LEAGUE REEL (league-wide superlatives)
//    Input:  league context + member summaries
//    Output: reel[] — array of league-wide awards
// ═══════════════════════════════════════════════════════════════════════════════

export const ReelItemSchema = z.object({
	award: z.string().min(1),
	winner: z.string().min(1),
	accent: AccentSchema,
	blurb: z.string().min(1),
}).strict();
export type ReelItem = z.infer<typeof ReelItemSchema>;

export const LeagueReelOutputSchema = z.object({
	reel: z.array(ReelItemSchema).min(3).max(8),
}).strict();
export type LeagueReelOutput = z.infer<typeof LeagueReelOutputSchema>;

const MemberSummarySchema = z.object({
	name: z.string(),
	fingerprint: FingerprintSchema,
	stat: z.object({ submitted: z.number(), avgPts: z.number(), wins: z.number() }),
});
export type MemberSummary = z.infer<typeof MemberSummarySchema>;

const LeagueReelInputSchema = z.object({
	leagueName: z.string().min(1),
	season: z.number().int().positive(),
	members: z.array(MemberSummarySchema).min(2),
});
export type LeagueReelInput = z.infer<typeof LeagueReelInputSchema>;

function buildLeagueReelMessages(
	input: LeagueReelInput,
): { role: 'system' | 'user'; content: string }[] {
	const memberLines = input.members
		.map((m) => {
			const fp = m.fingerprint;
			return `- ${m.name}: ${fp.summary} (submitted ${m.stat.submitted}, ${m.stat.wins} win(s), avg ${m.stat.avgPts.toFixed(1)} pts)`;
		})
		.join('\n');

	return [
		{
			role: 'system',
			content: `You are the chief yearbook editor for "${input.leagueName}", writing the league-wide superlative reel — the awards that go on the home page, each calling out one member.

${NO_STRIFE_CONSTRAINT}

Write 4–6 league-wide superlative awards. Each names a "winner" (use their exact name from the member list), an "award" title, an "accent" color, and a short "blurb". Vary the accents across awards.

Every award should feel like an honour — highlight something distinctive and wonderful about the person, not their ranking.

Output valid JSON with exactly:
{
  "reel": [{"award": "...", "winner": "<member name>", "accent": "pulp|amber|sky|moss|ember", "blurb": "..."}, ...]
}`,
		},
		{
			role: 'user',
			content: `League: ${input.leagueName} — Season ${input.season}

Members:
${memberLines}

Write the league-wide superlative reel.`,
		},
	];
}

export const leagueReelTask: PredictionTask<LeagueReelInput, LeagueReelOutput> = {
	id: 'narrative-league-reel',
	inputSchema: LeagueReelInputSchema,
	buildMessages: buildLeagueReelMessages,
	model: DEFAULT_MODEL,
	outputSchema: LeagueReelOutputSchema,
};

// ── Slice type for the read-model ─────────────────────────────────────────────
/** What the narrative generator contributes to the league-level read-model. */
export interface NarrativeLeagueSlice {
	reel: ReelItem[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. MOMENT LINES
//    Input:  the three key season moments (from deterministic generator)
//    Output: one celebratory line for each
// ═══════════════════════════════════════════════════════════════════════════════

export const MomentLinesOutputSchema = z.object({
	mostLovedLine: z.string().min(1),
	mostDivisiveLine: z.string().min(1),
	biggestUpsetLine: z.string().min(1),
}).strict();
export type MomentLinesOutput = z.infer<typeof MomentLinesOutputSchema>;

const MomentDataSchema = z.object({
	title: z.string(),
	artist: z.string(),
	submitter: z.string(),
	round: z.union([z.string(), z.number()]),
});

const MomentLinesInputSchema = z.object({
	leagueName: z.string().min(1),
	mostLoved: MomentDataSchema,
	mostDivisive: MomentDataSchema,
	biggestUpset: MomentDataSchema,
});
export type MomentLinesInput = z.infer<typeof MomentLinesInputSchema>;

function buildMomentLinesMessages(
	input: MomentLinesInput,
): { role: 'system' | 'user'; content: string }[] {
	const fmt = (m: { title: string; artist: string; submitter: string; round: string | number }) =>
		`"${m.title}" by ${m.artist} (submitted by ${m.submitter}, round ${m.round})`;

	return [
		{
			role: 'system',
			content: `You are writing the caption lines for the season's three key moments in the "${input.leagueName}" music league yearbook.

${NO_STRIFE_CONSTRAINT}

Write exactly one punchy, celebratory caption sentence for each moment:
- Most Loved: the song that got the most universal adoration — celebrate the group's taste
- Most Divisive: the song that split the room — celebrate the debate, not the sides
- Biggest Upset: the song nobody expected to win — celebrate the surprise

Captions should feel fun and shareable, like something you'd post in the group chat.

Output valid JSON with exactly:
{
  "mostLovedLine": "...",
  "mostDivisiveLine": "...",
  "biggestUpsetLine": "..."
}`,
		},
		{
			role: 'user',
			content: `Write moment captions for ${input.leagueName}.

Most Loved: ${fmt(input.mostLoved)}
Most Divisive: ${fmt(input.mostDivisive)}
Biggest Upset: ${fmt(input.mostLoved)}`,
		},
	];
}

export const momentLinesTask: PredictionTask<MomentLinesInput, MomentLinesOutput> = {
	id: 'narrative-moment-lines',
	inputSchema: MomentLinesInputSchema,
	buildMessages: buildMomentLinesMessages,
	model: DEFAULT_MODEL,
	outputSchema: MomentLinesOutputSchema,
};

// ── Re-export all tasks for convenience ───────────────────────────────────────

export const narrativeTasks = {
	playerSuperlatives: playerSuperlativesTask,
	fanHaterBlurbs: fanHaterBlurbTask,
	leagueReel: leagueReelTask,
	momentLines: momentLinesTask,
} as const;
