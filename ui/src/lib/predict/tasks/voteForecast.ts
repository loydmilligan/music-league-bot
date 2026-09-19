import type Database from 'better-sqlite3';
import { z } from 'zod';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';
import { modelForSection } from '../../digest/modelFor.js';
import { normName } from '../../server/boarzAnalysis.js';
import type { SubmitterOddsSong, SubmitterOddsPlayer } from './submitterOdds.js';

export interface VoteBudgetInfo {
  /** Total up-points a voter distributes per round. */
  upTotal: number;
  /** Per-song cap (max up-points one song can receive). */
  cap: number;
}

export interface VoteForecastInput {
  song: SubmitterOddsSong;
  theme: { name: string; description: string };
  budget: VoteBudgetInfo;
  players: SubmitterOddsPlayer[];
}

export const VoteForecastOutputSchema = z
  .object({
    players: z
      .array(
        z.object({
          name: z.string().min(1),
          points: z.number().min(0).max(12),
          note: z.string().min(1),
        }),
      )
      .min(1),
  })
  .strict();

export type VoteForecastOutput = z.infer<typeof VoteForecastOutputSchema>;

const VoteForecastInputSchema = z.custom<VoteForecastInput>(
  (v) =>
    v !== null && v !== undefined &&
    typeof (v as VoteForecastInput).song === 'object' &&
    typeof (v as VoteForecastInput).budget === 'object' &&
    Array.isArray((v as VoteForecastInput).players),
);

export function buildVoteForecastMessages(input: VoteForecastInput) {
  const { song, theme, budget, players } = input;
  const lines: string[] = [];

  lines.push('--- Round theme ---');
  lines.push(`Name: ${theme.name}`);
  if (theme.description) lines.push(`Description: ${theme.description}`);

  lines.push('\n--- The song ---');
  lines.push(`Title: ${song.title}`);
  lines.push(`Artist: ${song.artist}`);
  lines.push(song.metaBlock);

  lines.push(
    `\n--- Voting scale --- each voter distributes ${budget.upTotal} up-points per round; a single song can take at most ${budget.cap}. 0 means no up-vote (it may even get a down-vote); ${budget.cap} is the strongest endorsement possible.`,
  );

  lines.push('\n--- Player evidence profiles (one section per player) ---');
  for (const p of players) {
    lines.push(`\n### ${p.name}${p.competitorName !== p.name ? ` (league display name: ${p.competitorName})` : ''}`);
    lines.push(p.profileMd ?? 'No profile data available for this player.');
  }

  return [
    {
      role: 'system' as const,
      content: `You are a Music League analyst. Predict how many up-points each listed player would give the song below if it were submitted to this round.

Ground every prediction in the evidence profiles: their recorded high/low vote examples (tracks and point values), positive-vs-negative descriptor medians, taste summary, vote usage habits, and any direct chat statements. A polarizing song should earn high marks from matching players and near-zero from others — do not average players toward the middle.

Rules:
- points is between 0 and ${budget.cap}, one decimal allowed (an expected value). Respect the scale: most songs get middling-to-low marks; reserve ${budget.cap} for a strong profile match.
- Predict for EVERY listed player, exactly once, using their exact name. Never invent or omit players.
- note: one sentence with the main reason for your number.
- Round themes constrain choices; treat genre/era signals accordingly.
- Respond with JSON only, no prose: { "players": [ { "name": "...", "points": 0-${budget.cap}, "note": "..." } ] }`,
    },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}

export const voteForecastTask: PredictionTask<VoteForecastInput, VoteForecastOutput> = {
  id: 'vote-forecast',
  inputSchema: VoteForecastInputSchema,
  buildMessages: buildVoteForecastMessages,
  model: (db) => modelForSection('vote-forecast', db),
  outputSchema: VoteForecastOutputSchema,
};

export interface VoteForecastPlayerResult {
  name: string;
  competitorName: string;
  points: number;
  note: string;
}

export interface VoteForecastResult {
  players: VoteForecastPlayerResult[];
  meta: PredictionMeta;
  cacheHit: boolean;
  generatedAt: string;
}

type CachedRun = { output_json: string; model: string; cost_usd: number; latency_ms: number; created_at: string };

function lookupCache(db: Database.Database, roundId: number, spotifyUri: string): CachedRun | undefined {
  return db.prepare(
    `SELECT output_json, model, cost_usd, latency_ms, created_at
       FROM prediction_runs
      WHERE task_id = 'vote-forecast'
        AND round_id = ?
        AND json_extract(input_json, '$.song.spotifyUri') = ?
        AND output_json IS NOT NULL AND outcome IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
  ).get(roundId, spotifyUri) as CachedRun | undefined;
}

export async function runVoteForecast(
  db: Database.Database,
  opts: { roundId: number; input: VoteForecastInput; forceRegen?: boolean },
): Promise<VoteForecastResult> {
  if (!opts.forceRegen) {
    const cached = lookupCache(db, opts.roundId, opts.input.song.spotifyUri);
    if (cached) {
      return assemble(opts.input, VoteForecastOutputSchema.parse(JSON.parse(cached.output_json)), {
        model: cached.model, costUsd: cached.cost_usd, latencyMs: cached.latency_ms, rowId: '',
      }, true, cached.created_at);
    }
  }
  const { output, meta } = await runPrediction(db, voteForecastTask, opts.input, { roundId: opts.roundId });
  return assemble(opts.input, output, meta, false, new Date().toISOString());
}

function assemble(
  input: VoteForecastInput,
  output: VoteForecastOutput,
  meta: PredictionMeta,
  cacheHit: boolean,
  generatedAt: string,
): VoteForecastResult {
  const byName = new Map(output.players.map((p) => [normName(p.name), p]));
  const cap = input.budget.cap;
  const players: VoteForecastPlayerResult[] = input.players.map((p) => {
    const hit = byName.get(normName(p.name));
    const pts = hit ? Math.max(0, Math.min(cap, hit.points)) : 0;
    return {
      name: p.name,
      competitorName: p.competitorName,
      points: Math.round(pts * 10) / 10,
      note: hit?.note ?? '',
    };
  });
  players.sort((a, b) => b.points - a.points);
  return { players, meta, cacheHit, generatedAt };
}
