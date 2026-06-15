import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { PlayerContext } from '../../predict/playerContext.js';
import { buildPlayerContext } from '../../predict/playerContext.js';
import type { PredictionTask } from '../../predict/predict.js';
import { runPrediction } from '../../predict/predict.js';

// ── Slice types ────────────────────────────────────────────────────────────────
// Exported so build-readmodel can compose them without knowing this file's internals.

export const SpectrumAxisSchema = z.object({
	left: z.string(),
	right: z.string(),
	value: z.number().int().min(0).max(100),
});
export type SpectrumAxis = z.infer<typeof SpectrumAxisSchema>;

/** The spectrum slice as it appears in the read-model fixture: 3 fixed axes. */
export const SpectrumSliceSchema = z.tuple([
	SpectrumAxisSchema,
	SpectrumAxisSchema,
	SpectrumAxisSchema,
]);
export type SpectrumSlice = z.infer<typeof SpectrumSliceSchema>;

export const PlaylistTrackSchema = z.object({
	title: z.string(),
	artist: z.string(),
	why: z.string(),
});
export type PlaylistTrack = z.infer<typeof PlaylistTrackSchema>;

export const PlaylistSliceSchema = z.object({
	name: z.string(),
	nudge: z.string(),
	tracks: z.array(PlaylistTrackSchema).min(1).max(3),
});
export type PlaylistSlice = z.infer<typeof PlaylistSliceSchema>;

export const ProfileSliceSchema = z.object({
	spectrum: SpectrumSliceSchema,
	playlist: PlaylistSliceSchema,
});
export type ProfileSlice = z.infer<typeof ProfileSliceSchema>;

// ── Internal LLM output schemas ────────────────────────────────────────────────

// The LLM returns plain integer values; we attach the fixed axis labels ourselves
// to prevent label drift.
const SpectrumLLMOutputSchema = z.object({
	polished_vs_raw: z.number().int().min(0).max(100),
	sunny_vs_melancholy: z.number().int().min(0).max(100),
	familiar_vs_obscure: z.number().int().min(0).max(100),
});
type SpectrumLLMOutput = z.infer<typeof SpectrumLLMOutputSchema>;

// ── Input schema (PlayerContext) ───────────────────────────────────────────────

const PlayerContextSchema = z.custom<PlayerContext>(
	(v) => v !== null && v !== undefined && typeof (v as PlayerContext).playerId === 'number',
);

// ── Prompt helpers ─────────────────────────────────────────────────────────────

function buildContextLines(ctx: PlayerContext): string {
	const lines: string[] = [];
	lines.push(`Player: ${ctx.playerName} (id: ${ctx.playerId})`);
	lines.push(`Win rate: ${(ctx.winRate * 100).toFixed(1)}%`);

	const fp = ctx.dossier.tasteFingerprint as Record<string, unknown> | null;
	if (fp) {
		if (Array.isArray(fp['signature_artists']) && fp['signature_artists'].length) {
			lines.push(`\nSignature artists: ${(fp['signature_artists'] as string[]).join(', ')}`);
		}
		if (Array.isArray(fp['genres']) && fp['genres'].length) {
			lines.push(`Genres: ${(fp['genres'] as string[]).join(', ')}`);
		}
		if (Array.isArray(fp['eras']) && fp['eras'].length) {
			lines.push(`Eras: ${(fp['eras'] as string[]).join(', ')}`);
		}
		if (Array.isArray(fp['rewards']) && fp['rewards'].length) {
			lines.push(`Rewards: ${(fp['rewards'] as string[]).join(', ')}`);
		}
		if (Array.isArray(fp['punishes']) && fp['punishes'].length) {
			lines.push(`Punishes: ${(fp['punishes'] as string[]).join(', ')}`);
		}
		if (typeof fp['summary'] === 'string') {
			lines.push(`Taste summary: ${fp['summary']}`);
		}
	}

	if (ctx.dossier.notes) {
		lines.push(`\nOwner notes: ${ctx.dossier.notes}`);
	}

	if (ctx.submissions.length) {
		lines.push(`\nSubmissions (most recent first, ${ctx.submissions.length} shown):`);
		for (const s of ctx.submissions.slice(0, 20)) {
			lines.push(`  [${s.pointsReceived} pts] ${s.artist} — "${s.title}" (${s.round})`);
		}
	} else {
		lines.push('\nNo submission history.');
	}

	if (ctx.votesCast.length) {
		lines.push(`\nVotes cast (most recent first, ${ctx.votesCast.length} shown):`);
		for (const v of ctx.votesCast.slice(0, 20)) {
			lines.push(`  [${v.pointsGiven} pts] ${v.songArtist} — "${v.songTitle}" (${v.round})`);
		}
	} else {
		lines.push('\nNo voting history.');
	}

	if (ctx.boundingApplied) {
		lines.push('\n(Note: history was trimmed to fit context limits.)');
	}

	return lines.join('\n');
}

function buildSpectrumMessages(ctx: PlayerContext) {
	const contextBlock = buildContextLines(ctx);
	const hasHistory = ctx.submissions.length > 0 || ctx.votesCast.length > 0;

	return [
		{
			role: 'system' as const,
			content: `You are a music taste analyst for a private music league. Given a player's taste fingerprint and gameplay history, position them on three musical personality axes.

Each axis is a 0–100 integer (0 = fully left, 100 = fully right):

- polished_vs_raw: 0 = heavily produced / studio-perfect, 100 = raw / lo-fi / rough edges
- sunny_vs_melancholy: 0 = bright / upbeat / joyful, 100 = dark / sad / introspective
- familiar_vs_obscure: 0 = well-known / mainstream, 100 = deep cuts / obscure / unknown artists

${!hasHistory ? 'This player has little or no history — place them near the middle (40–60) on each axis.' : 'Be specific and grounded in the actual data. Do not place anyone at exactly 50 unless the data is genuinely ambiguous.'}

Output a JSON object with EXACTLY these fields:
{
  "polished_vs_raw": <integer 0-100>,
  "sunny_vs_melancholy": <integer 0-100>,
  "familiar_vs_obscure": <integer 0-100>
}`,
		},
		{
			role: 'user' as const,
			content: contextBlock,
		},
	];
}

function buildPlaylistMessages(ctx: PlayerContext) {
	const contextBlock = buildContextLines(ctx);
	const hasHistory = ctx.submissions.length > 0 || ctx.votesCast.length > 0;
	const trackCount = hasHistory ? 3 : 1;

	return [
		{
			role: 'system' as const,
			content: `You are a music curator generating a personalised discovery playlist for a member of a private music league. The playlist contains songs this player has NOT submitted before but would very likely love — based on their taste fingerprint, voting patterns, and submission history.

Tone: warm, slightly playful, "we know you" energy. Like a friend who's been paying attention.

Guidelines:
- The playlist name should be personal and specific to this player (e.g. "Songs Marisol Hasn't Found Yet", "Pop, Expand Your Horizons (Gently)").
- The nudge is one short, punchy line that sets the agenda — a gentle character insight or challenge.
- Each track needs a "why": one sentence, grounded in something real about this player's taste.
- Pick ${trackCount} track${trackCount > 1 ? 's' : ''} (do not repeat any artist or song they have already submitted).
${!hasHistory ? '- This player has limited history: use what you know about the genre/era signals and be honest about the thin signal.' : ''}

Output a JSON object with EXACTLY this shape:
{
  "name": "<playlist name>",
  "nudge": "<one-line agenda>",
  "tracks": [
    { "title": "<song title>", "artist": "<artist name>", "why": "<one sentence>" }
  ]
}`,
		},
		{
			role: 'user' as const,
			content: contextBlock,
		},
	];
}

// ── Task definitions ───────────────────────────────────────────────────────────

const DEFAULT_MODEL = process.env.OPENROUTER_PREDICT_MODEL ?? 'anthropic/claude-sonnet-4-5';

export const spectrumTask: PredictionTask<PlayerContext, SpectrumLLMOutput> = {
	id: 'profile-spectrum',
	inputSchema: PlayerContextSchema,
	buildMessages: buildSpectrumMessages,
	model: DEFAULT_MODEL,
	outputSchema: SpectrumLLMOutputSchema,
};

export const playlistTask: PredictionTask<PlayerContext, PlaylistSlice> = {
	id: 'profile-playlist',
	inputSchema: PlayerContextSchema,
	buildMessages: buildPlaylistMessages,
	model: DEFAULT_MODEL,
	outputSchema: PlaylistSliceSchema,
};

// ── generateProfile ────────────────────────────────────────────────────────────

/**
 * Generate the spectrum + discovery playlist for a player.
 * Runs both LLM tasks in parallel (both logged to prediction_runs).
 * Safe for players with no gameplay history — returns sensible defaults.
 */
export async function generateProfile(
	db: Database.Database,
	playerId: number,
): Promise<ProfileSlice> {
	const ctx = buildPlayerContext(db, playerId);

	const [spectrumResult, playlistResult] = await Promise.all([
		runPrediction(db, spectrumTask, ctx, { playerId }),
		runPrediction(db, playlistTask, ctx, { playerId }),
	]);

	const llm = spectrumResult.output;
	const spectrum: SpectrumSlice = [
		{ left: 'Polished', right: 'Raw', value: llm.polished_vs_raw },
		{ left: 'Sunny', right: 'Melancholy', value: llm.sunny_vs_melancholy },
		{ left: 'Familiar', right: 'Obscure', value: llm.familiar_vs_obscure },
	];

	return {
		spectrum,
		playlist: playlistResult.output,
	};
}
