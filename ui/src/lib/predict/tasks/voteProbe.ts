import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { PlayerContext } from '../playerContext.js';
import { buildPlayerContext } from '../playerContext.js';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';
import { modelForSection } from '../../digest/modelFor.js';

// ── Song + theme inputs (bundled with PlayerContext into the full task input) ──

export interface VoteProbeSong {
  title: string;
  artist: string;
  spotify_url?: string;
}

export interface VoteProbeTheme {
  name: string;
  description: string;
}

/** Full input: PlayerContext extended with the song + theme being probed. */
export interface VoteProbeInput extends PlayerContext {
  song: VoteProbeSong;
  theme: VoteProbeTheme;
}

// ── Output schema ──────────────────────────────────────────────────────────────
//
// upvote_likelihood is the SAS (Standalone Affinity Score): this player's lean
// toward the song, independent of any round or competition context.
// Zod enforces the 0–100 bound and the non-empty reasoning requirement.

export const VoteProbeOutputSchema = z.object({
  upvote_likelihood: z.number().min(0).max(100),
  expected_points: z.number(),
  confidence: z.enum(['low', 'medium', 'high']),
  reasoning: z.string().min(1),
  signals: z.array(z.string()),
});

export type VoteProbeOutput = z.infer<typeof VoteProbeOutputSchema>;

// ── Input schema ───────────────────────────────────────────────────────────────

const VoteProbeInputSchema = z.custom<VoteProbeInput>(
  (v) =>
    v !== null &&
    v !== undefined &&
    typeof (v as VoteProbeInput).playerId === 'number' &&
    typeof (v as VoteProbeInput).song === 'object' &&
    (v as VoteProbeInput).song !== null &&
    typeof (v as VoteProbeInput).theme === 'object' &&
    (v as VoteProbeInput).theme !== null,
);

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildVoteProbeMessages(input: VoteProbeInput) {
  const { song, theme } = input;
  const ctx: PlayerContext = input;

  const lines: string[] = [];

  lines.push(`Player: ${ctx.playerName} (id: ${ctx.playerId})`);
  lines.push(`Win rate: ${(ctx.winRate * 100).toFixed(1)}%`);

  if (ctx.dossier.notes) lines.push(`\nOwner notes: ${ctx.dossier.notes}`);
  if (ctx.dossier.tags.length) lines.push(`Owner tags: ${ctx.dossier.tags.join(', ')}`);

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
    lines.push('\nTaste overlap with peers (Jaccard):');
    for (const t of ctx.tasteOverlap) {
      lines.push(`  ${t.playerName}: ${t.jaccardScore.toFixed(3)}`);
    }
  }

  if (ctx.boundingApplied) lines.push('\n(Note: history was trimmed to fit context limits.)');

  lines.push('\n--- Song to evaluate ---');
  lines.push(`Title: ${song.title}`);
  lines.push(`Artist: ${song.artist}`);
  if (song.spotify_url) lines.push(`Spotify: ${song.spotify_url}`);

  lines.push('\n--- Theme ---');
  lines.push(`Name: ${theme.name}`);
  lines.push(`Description: ${theme.description}`);

  return [
    {
      role: 'system' as const,
      content: `You are a music taste analyst for a private music league. Given a player's history, predict how much they would personally enjoy and vote for a specific song in a specific theme round.

This is a STANDALONE AFFINITY SCORE (SAS) — measure this player's personal lean toward the song, independent of any round, competition context, or other players. Do NOT model strategy or vote allocation.

upvote_likelihood scale (0–100):
- 0–20:  very unlikely to vote for this song
- 21–40: below-average affinity
- 41–60: moderate / uncertain
- 61–80: likely to vote for this song
- 81–100: strongly fits their taste

Confidence calibration:
- "low": fewer than 5 submissions or votes — limited signal
- "medium": 5–20 submissions or reasonable vote history
- "high": 20+ submissions with consistent patterns

CRITICAL: The "reasoning" field MUST cite specific evidence from the player's actual history (e.g. "gave 4 pts to similar synth-pop in round X", "never rewards country submissions", "consistently upvotes this artist's submissions"). Generic reasoning that doesn't reference the player's real history is unacceptable.

Output a JSON object with EXACTLY these fields:
{
  "upvote_likelihood": <number 0–100, standalone affinity lean>,
  "expected_points": <number of points this player would likely award>,
  "confidence": "low" | "medium" | "high",
  "reasoning": "<1–3 sentences citing specific history>",
  "signals": [<2–5 short phrases identifying the key taste signals observed>]
}`,
    },
    {
      role: 'user' as const,
      content: lines.join('\n'),
    },
  ];
}

// ── Task definition ────────────────────────────────────────────────────────────

export const voteProbeTask: PredictionTask<VoteProbeInput, VoteProbeOutput> = {
  id: 'vote-probe',
  inputSchema: VoteProbeInputSchema,
  buildMessages: buildVoteProbeMessages,
  model: (db) => modelForSection('vote-probe', db),
  outputSchema: VoteProbeOutputSchema,
};

// ── Result type ───────────────────────────────────────────────────────────────

export interface RunVoteProbeResult {
  output: VoteProbeOutput;
  meta: PredictionMeta;
  cacheHit: boolean;
  generatedAt: string;
}

// ── Cache lookup ──────────────────────────────────────────────────────────────

type CachedRun = { output_json: string; model: string; cost_usd: number; latency_ms: number; created_at: string };

function lookupVoteProbeCache(
  db: Database.Database,
  playerId: number,
  song: VoteProbeSong,
  theme: VoteProbeTheme,
): CachedRun | undefined {
  return db.prepare(
    `SELECT output_json, model, cost_usd, latency_ms, created_at
     FROM prediction_runs
     WHERE task_id = 'vote-probe'
       AND player_id = ?
       AND json_extract(input_json, '$.song.title') = ?
       AND json_extract(input_json, '$.song.artist') = ?
       AND json_extract(input_json, '$.theme.name') = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get(playerId, song.title, song.artist, theme.name) as CachedRun | undefined;
}

// ── runVoteProbe ──────────────────────────────────────────────────────────────

/**
 * Build the player's context, run the vote-probe task, and log a prediction_runs row.
 *
 * On repeat calls with the same (player, song, theme), returns the cached
 * prediction_runs row without calling the model. Pass forceRegen:true to
 * bypass the cache and write a fresh row.
 *
 * `roundId` should be set when `theme` corresponds to a real DB round so the
 * prediction_runs row is linkable for Sprint 3 backtest scoring.
 */
export async function runVoteProbe(
  db: Database.Database,
  playerId: number,
  opts: {
    song: VoteProbeSong;
    theme: VoteProbeTheme;
    roundId?: number;
    forceRegen?: boolean;
  },
): Promise<RunVoteProbeResult> {
  if (!opts.forceRegen) {
    const cached = lookupVoteProbeCache(db, playerId, opts.song, opts.theme);
    if (cached) {
      const output = VoteProbeOutputSchema.parse(JSON.parse(cached.output_json));
      return {
        output,
        meta: { model: cached.model, costUsd: cached.cost_usd, latencyMs: cached.latency_ms, rowId: '' },
        cacheHit: true,
        generatedAt: cached.created_at,
      };
    }
  }

  const context = buildPlayerContext(db, playerId);
  const input: VoteProbeInput = { ...context, song: opts.song, theme: opts.theme };

  const { output, meta } = await runPrediction(db, voteProbeTask, input, {
    playerId,
    roundId: opts.roundId,
  });

  const row = db.prepare(
    `SELECT created_at FROM prediction_runs
     WHERE task_id = 'vote-probe' AND player_id = ?
     ORDER BY created_at DESC LIMIT 1`,
  ).get(playerId) as { created_at: string } | undefined;

  return { output, meta, cacheHit: false, generatedAt: row?.created_at ?? new Date().toISOString() };
}
