import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { PlayerContext } from '../playerContext.js';
import { buildPlayerContext } from '../playerContext.js';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';
import { modelForSection } from '../../digest/modelFor.js';

// ── Output schema ──────────────────────────────────────────────────────────────

export const FingerprintOutputSchema = z.object({
	signature_artists: z.array(z.string()),
	genres: z.array(z.string()),
	eras: z.array(z.string()),
	rewards: z.array(z.string()),
	punishes: z.array(z.string()),
	summary: z.string(),
	confidence: z.enum(['low', 'medium', 'high']),
});

export type FingerprintOutput = z.infer<typeof FingerprintOutputSchema>;

// ── Input schema (PlayerContext — validated at the boundary) ───────────────────

const PlayerContextSchema = z.custom<PlayerContext>(
	(v) => v !== null && v !== undefined && typeof (v as PlayerContext).playerId === 'number',
);

// ── Prompt helpers ─────────────────────────────────────────────────────────────

function buildFingerprintMessages(ctx: PlayerContext) {
	const lines: string[] = [];

	lines.push(`Player: ${ctx.playerName} (id: ${ctx.playerId})`);
	lines.push(`Win rate: ${(ctx.winRate * 100).toFixed(1)}%`);

	if (ctx.dossier.notes) {
		lines.push(`\nOwner notes: ${ctx.dossier.notes}`);
	}
	if (ctx.dossier.tags.length) {
		lines.push(`Owner tags: ${ctx.dossier.tags.join(', ')}`);
	}

	if (ctx.submissions.length) {
		lines.push(`\nSubmissions (most recent first, ${ctx.submissions.length} shown):`);
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
			lines.push(`  [${v.pointsGiven} pts] ${v.songArtist} — "${v.songTitle}" (${v.round})${cmt}`);
		}
	} else {
		lines.push('\nNo voting history.');
	}

	if (ctx.tasteOverlap.length) {
		lines.push(`\nTaste overlap with peers (Jaccard):`);
		for (const t of ctx.tasteOverlap) {
			lines.push(`  ${t.playerName}: ${t.jaccardScore.toFixed(3)}`);
		}
	}

	if (ctx.boundingApplied) {
		lines.push('\n(Note: history was trimmed to fit context limits.)');
	}

	const userPrompt = lines.join('\n');

	return [
		{
			role: 'system' as const,
			content: `You are a music taste analyst for a private music league. Given a player's submission and voting history, produce a structured taste fingerprint.

Be specific and grounded in the actual data. Reference real artists, genres, and eras you observe in the history. Do NOT invent patterns that are not supported by the data.

Confidence calibration:
- "low": fewer than 5 submissions or votes — very limited signal
- "medium": 5–20 submissions or reasonable vote history — moderate signal
- "high": 20+ submissions with consistent patterns — strong signal

Output a JSON object with EXACTLY these fields:
{
  "signature_artists": [array of artist names this player consistently rewards or submits — top 3-8],
  "genres": [array of genre labels this player gravitates toward — top 3-6],
  "eras": [array of decade/era strings like "80s", "early 2000s", "contemporary" — top 1-4],
  "rewards": [array of musical qualities or characteristics they vote UP — top 3-6],
  "punishes": [array of qualities they vote LOW or avoid — top 2-5],
  "summary": "1-2 sentence narrative description of this player's musical identity",
  "confidence": "low" | "medium" | "high"
}`,
		},
		{
			role: 'user' as const,
			content: userPrompt,
		},
	];
}

// ── Task definition ────────────────────────────────────────────────────────────

export const tasteFingerprintTask: PredictionTask<PlayerContext, FingerprintOutput> = {
	id: 'taste-fingerprint',
	inputSchema: PlayerContextSchema,
	buildMessages: buildFingerprintMessages,
	model: (db) => modelForSection('taste-fingerprint', db),
	outputSchema: FingerprintOutputSchema,
};

// ── Result type ────────────────────────────────────────────────────────────────

export interface GenerateFingerprintResult {
	fingerprint: FingerprintOutput;
	meta: PredictionMeta;
}

// ── generateFingerprint ────────────────────────────────────────────────────────

/**
 * Build the player's context, run the taste-fingerprint task, and persist the
 * result to player_profiles.
 *
 * Writes ONLY the AI columns (taste_fingerprint, fingerprint_model,
 * fingerprint_cost_usd, fingerprint_generated_at, updated_at).
 * The owner's notes and tags are NEVER touched — manual/auto separation is
 * sacred (sprint-28 working agreement).
 */
export async function generateFingerprint(
	db: Database.Database,
	playerId: number,
): Promise<GenerateFingerprintResult> {
	const context = buildPlayerContext(db, playerId);
	const { output: fingerprint, meta } = await runPrediction(
		db,
		tasteFingerprintTask,
		context,
		{ playerId },
	);

	const now = new Date().toISOString();

	// Ensure a profile row exists (INSERT OR IGNORE keeps notes/tags intact).
	db.prepare('INSERT OR IGNORE INTO player_profiles (player_id) VALUES (?)').run(playerId);

	// Update ONLY the AI provenance columns — never notes or tags.
	db.prepare(
		`UPDATE player_profiles
		 SET taste_fingerprint        = ?,
		     fingerprint_model        = ?,
		     fingerprint_cost_usd     = ?,
		     fingerprint_generated_at = ?,
		     updated_at               = ?
		 WHERE player_id = ?`,
	).run(
		JSON.stringify(fingerprint),
		meta.model,
		meta.costUsd,
		now,
		now,
		playerId,
	);

	return { fingerprint, meta };
}
