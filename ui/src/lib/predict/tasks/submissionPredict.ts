import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { PlayerContext } from '../playerContext.js';
import { buildPlayerContext } from '../playerContext.js';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';

// ── Theme input ────────────────────────────────────────────────────────────────

export interface SubmissionPredictTheme {
	name: string;
	description: string;
}

/** Full input: PlayerContext extended with the theme to predict for. */
export interface SubmissionPredictInput extends PlayerContext {
	theme: SubmissionPredictTheme;
}

// ── Output schema (three-part) ─────────────────────────────────────────────────

export const SubmissionProfileSchema = z.object({
	genres: z.array(z.string()),
	artists_or_types: z.array(z.string()),
	era: z.string().min(1),
	mood_energy: z.string().min(1),
	obscurity_lean: z.string().min(1),
	comment_likely: z.boolean(),
	rationale: z.string().min(1),
});

export const SubmissionCandidateSchema = z.object({
	title: z.string().min(1),
	artist: z.string().min(1),
	why: z.string().min(1),
});

export const SimilarPastPickSchema = z.object({
	title: z.string().min(1),
	artist: z.string().min(1),
	round: z.string().min(1),
	similarity: z.string().min(1),
});

export const SubmissionPredictionSchema = z.object({
	title: z.string().min(1),
	artist: z.string().min(1),
	spotify_url: z.string().optional(),
	detail: z.string().min(1),
	similar_past_picks: z.array(SimilarPastPickSchema),
	confidence: z.enum(['low', 'medium', 'high']),
});

export const SubmissionPredictOutputSchema = z.object({
	profile: SubmissionProfileSchema,
	candidates: z.array(SubmissionCandidateSchema).min(4).max(6),
	prediction: SubmissionPredictionSchema,
});

export type SubmissionPredictOutput = z.infer<typeof SubmissionPredictOutputSchema>;

// ── Input schema ───────────────────────────────────────────────────────────────

const SubmissionPredictInputSchema = z.custom<SubmissionPredictInput>(
	(v) =>
		v !== null &&
		v !== undefined &&
		typeof (v as SubmissionPredictInput).playerId === 'number' &&
		typeof (v as SubmissionPredictInput).theme === 'object' &&
		(v as SubmissionPredictInput).theme !== null,
);

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildSubmissionPredictMessages(input: SubmissionPredictInput) {
	const { theme } = input;
	const ctx: PlayerContext = input;

	const lines: string[] = [];

	lines.push(`Player: ${ctx.playerName} (id: ${ctx.playerId})`);
	lines.push(`Win rate: ${(ctx.winRate * 100).toFixed(1)}%`);

	if (ctx.dossier.notes) lines.push(`\nOwner notes: ${ctx.dossier.notes}`);
	if (ctx.dossier.tags.length) lines.push(`Owner tags: ${ctx.dossier.tags.join(', ')}`);
	if (ctx.dossier.tasteFingerprint) {
		lines.push(`Taste fingerprint: ${JSON.stringify(ctx.dossier.tasteFingerprint)}`);
	}

	if (ctx.submissions.length) {
		lines.push(`\nPast submissions (most recent first, ${ctx.submissions.length} shown):`);
		for (const s of ctx.submissions) {
			lines.push(`  [${s.pointsReceived} pts] ${s.artist} — "${s.title}" (${s.round})`);
		}
	} else {
		lines.push('\nNo submission history.');
	}

	if (ctx.votesCast.length) {
		lines.push(`\nVotes cast (most recent first, ${ctx.votesCast.length} shown):`);
		for (const v of ctx.votesCast) {
			const cmt = v.comment ? ` — "${v.comment}"` : '';
			lines.push(
				`  [${v.pointsGiven} pts] ${v.songArtist} — "${v.songTitle}" (${v.round})${cmt}`,
			);
		}
	} else {
		lines.push('\nNo voting history.');
	}

	if (ctx.tasteOverlap.length) {
		lines.push('\nTaste overlap with peers (Jaccard):');
		for (const t of ctx.tasteOverlap) {
			lines.push(`  ${t.playerName}: ${t.jaccardScore.toFixed(3)}`);
		}
	}

	if (ctx.boundingApplied) lines.push('\n(Note: history was trimmed to fit context limits.)');

	lines.push('\n--- Theme to predict for ---');
	lines.push(`Name: ${theme.name}`);
	lines.push(`Description: ${theme.description}`);

	return [
		{
			role: 'system' as const,
			content: `You are a music taste analyst for a private music league. Given a player's submission and voting history, predict what song they would submit for a specific theme round.

Your prediction must follow the player's demonstrated taste patterns. Ground every claim in specific evidence from their actual history — generic analysis is unacceptable.

Output a JSON object with EXACTLY this structure:
{
  "profile": {
    "genres": ["<genre>", ...],
    "artists_or_types": ["<specific artist or 'type of artist'>", ...],
    "era": "<era description, e.g. '80s–90s alternative'>",
    "mood_energy": "<mood/energy description, e.g. 'brooding mid-tempo'>",
    "obscurity_lean": "<e.g. 'leans deep-cut', 'mainstream', 'prefers indie cult favorites'>",
    "comment_likely": <true if player often comments on their picks for this type of theme>,
    "rationale": "<1–3 sentences grounded in the player's actual submission/vote history>"
  },
  "candidates": [
    { "title": "<song title>", "artist": "<artist name>", "why": "<1–2 sentences — why THIS player for THIS theme>" },
    ... (4–6 candidates total, ranked best-first)
  ],
  "prediction": {
    "title": "<most-likely song title>",
    "artist": "<artist name>",
    "spotify_url": "<optional — only include if you are certain of the exact Spotify URL>",
    "detail": "<why THIS song over the other candidates — cite specific history evidence>",
    "similar_past_picks": [
      { "title": "<past submission title>", "artist": "<artist>", "round": "<round name>", "similarity": "<what makes it similar>" }
    ],
    "confidence": "low" | "medium" | "high"
  }
}

Confidence calibration:
- "low": fewer than 5 submissions — limited signal; broad theme fit only
- "medium": 5–20 submissions with some consistent taste signals
- "high": 20+ submissions with clear, repeating genre/artist/era patterns

CRITICAL:
- Candidates MUST be exactly 4–6 entries.
- Do NOT set spotify_url unless you are certain of the real Spotify track URL. Leave it out rather than guess.
- similar_past_picks MUST reference songs from the player's ACTUAL submission history shown above. If no close matches exist, return an empty array.
- Rationale and detail MUST cite specific rounds or songs from the player's history.`,
		},
		{
			role: 'user' as const,
			content: lines.join('\n'),
		},
	];
}

// ── Task definition ────────────────────────────────────────────────────────────

const DEFAULT_MODEL =
	process.env.OPENROUTER_PREDICT_MODEL ?? 'anthropic/claude-sonnet-4-5';

export const submissionPredictTask: PredictionTask<
	SubmissionPredictInput,
	SubmissionPredictOutput
> = {
	id: 'submission-predict',
	inputSchema: SubmissionPredictInputSchema,
	buildMessages: buildSubmissionPredictMessages,
	model: DEFAULT_MODEL,
	outputSchema: SubmissionPredictOutputSchema,
};

// ── Result type ────────────────────────────────────────────────────────────────

export interface RunSubmissionPredictResult {
	output: SubmissionPredictOutput;
	meta: PredictionMeta;
	cacheHit: boolean;
	generatedAt: string;
}

// ── Cache lookup ───────────────────────────────────────────────────────────────

type CachedRun = { output_json: string; model: string; cost_usd: number; latency_ms: number; created_at: string };

function lookupSubmissionPredictCache(
	db: Database.Database,
	playerId: number,
	theme: SubmissionPredictTheme,
): CachedRun | undefined {
	return db.prepare(
		`SELECT output_json, model, cost_usd, latency_ms, created_at
		 FROM prediction_runs
		 WHERE task_id = 'submission-predict'
		   AND player_id = ?
		   AND json_extract(input_json, '$.theme.name') = ?
		 ORDER BY created_at DESC
		 LIMIT 1`,
	).get(playerId, theme.name) as CachedRun | undefined;
}

// ── runSubmissionPredict ───────────────────────────────────────────────────────

/**
 * Build the player's context, run the submission-predict task, and log a
 * prediction_runs row.
 *
 * On repeat calls with the same (player, theme), returns the cached
 * prediction_runs row without calling the model. Pass forceRegen:true to
 * bypass the cache and write a fresh row.
 *
 * Returns RAW candidates — Spotify validation is applied downstream by
 * api-submission (spotifyValidate.ts), not here.
 *
 * `roundId` should be set when `theme` corresponds to a real DB round so the
 * prediction_runs row is linkable for future backtest scoring.
 */
export async function runSubmissionPredict(
	db: Database.Database,
	playerId: number,
	opts: {
		theme: SubmissionPredictTheme;
		roundId?: number;
		forceRegen?: boolean;
	},
): Promise<RunSubmissionPredictResult> {
	if (!opts.forceRegen) {
		const cached = lookupSubmissionPredictCache(db, playerId, opts.theme);
		if (cached) {
			const output = SubmissionPredictOutputSchema.parse(JSON.parse(cached.output_json));
			return {
				output,
				meta: { model: cached.model, costUsd: cached.cost_usd, latencyMs: cached.latency_ms },
				cacheHit: true,
				generatedAt: cached.created_at,
			};
		}
	}

	const context = buildPlayerContext(db, playerId);
	const input: SubmissionPredictInput = { ...context, theme: opts.theme };

	const { output, meta } = await runPrediction(db, submissionPredictTask, input, {
		playerId,
		roundId: opts.roundId,
	});

	const row = db.prepare(
		`SELECT created_at FROM prediction_runs
		 WHERE task_id = 'submission-predict' AND player_id = ?
		 ORDER BY created_at DESC LIMIT 1`,
	).get(playerId) as { created_at: string } | undefined;

	return { output, meta, cacheHit: false, generatedAt: row?.created_at ?? new Date().toISOString() };
}
