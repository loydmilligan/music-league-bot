import type Database from 'better-sqlite3';
import { z } from 'zod';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';
import { modelForSection } from '../../digest/modelFor.js';
import { normName } from '../../server/boarzAnalysis.js';

export interface SubmitterOddsSong {
  title: string;
  artist: string;
  spotifyUri: string;
  /** Pre-rendered metadata block (catalog + DB), one fact per line. */
  metaBlock: string;
}

export interface SubmitterOddsPlayer {
  name: string;
  competitorName: string;
  profileMd: string | null;
}

export interface SubmitterOddsInput {
  song: SubmitterOddsSong;
  theme: { name: string; description: string };
  players: SubmitterOddsPlayer[];
}

export const SubmitterOddsOutputSchema = z
  .object({
    players: z
      .array(
        z.object({
          name: z.string().min(1),
          likelihood: z.number().min(0).max(10),
          note: z.string().min(1),
        }),
      )
      .min(1),
  })
  .strict();

export type SubmitterOddsOutput = z.infer<typeof SubmitterOddsOutputSchema>;

const SubmitterOddsInputSchema = z.custom<SubmitterOddsInput>(
  (v) =>
    v !== null && v !== undefined &&
    typeof (v as SubmitterOddsInput).song === 'object' &&
    typeof (v as SubmitterOddsInput).theme === 'object' &&
    Array.isArray((v as SubmitterOddsInput).players),
);

export function buildSubmitterOddsMessages(input: SubmitterOddsInput) {
  const { song, theme, players } = input;
  const lines: string[] = [];

  lines.push('--- Round theme ---');
  lines.push(`Name: ${theme.name}`);
  if (theme.description) lines.push(`Description: ${theme.description}`);

  lines.push('\n--- The song ---');
  lines.push(`Title: ${song.title}`);
  lines.push(`Artist: ${song.artist}`);
  lines.push(song.metaBlock);

  lines.push('\n--- Player evidence profiles (one section per player) ---');
  for (const p of players) {
    lines.push(`\n### ${p.name}${p.competitorName !== p.name ? ` (league display name: ${p.competitorName})` : ''}`);
    lines.push(p.profileMd ?? 'No profile data available for this player.');
  }

  return [
    {
      role: 'system' as const,
      content: `You are a Music League analyst. One song was submitted to the round described below by exactly ONE of the listed players (never by the league owner, and it fits the theme). Your job: estimate for each player the likelihood that THEY are the submitter.

Ground every score in the evidence profiles: their past submissions under similar themes, their recorded high/low vote examples, the positive-vs-negative descriptor medians, their taste summary, and any direct chat statements.

Rules:
- likelihood is 0-10 (10 = virtually certain it was them, 0 = virtually certain it was not). The numbers express RELATIVE fit: a clear favorite must stand out; near-certain non-matches must be near 0.
- Score EVERY listed player, exactly once, using their exact name. Never invent or omit players.
- note: one sentence citing the strongest specific piece of evidence for your number.
- The profiles describe historical taste, not certainty. Round themes constrain choices; say so when a theme weakens the evidence.
- Respond with JSON only, no prose: { "players": [ { "name": "...", "likelihood": 0-10, "note": "..." } ] }`,
    },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}

export const submitterOddsTask: PredictionTask<SubmitterOddsInput, SubmitterOddsOutput> = {
  id: 'submitter-odds',
  inputSchema: SubmitterOddsInputSchema,
  buildMessages: buildSubmitterOddsMessages,
  model: (db) => modelForSection('submitter-odds', db),
  outputSchema: SubmitterOddsOutputSchema,
};

/**
 * Scale raw likelihoods to one-decimal values that sum to exactly 10.0
 * (a probability distribution over the roster, ×10), using largest-remainder
 * rounding so the displayed numbers never drift off the total. All allocation
 * math is integer-exact: float noise in the fractional parts cannot reorder
 * who receives the surplus tenths.
 */
export function normalizeToTen(raw: number[]): number[] {
  const n = raw.length;
  if (!n) return [];
  const clamped = raw.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const sum = clamped.reduce((a, b) => a + b, 0);
  if (sum <= 0) return Array.from({ length: n }, () => Math.round((10 / n) * 10) / 10);

  // Shares in tenths of 10.0 (=100 tenths), scaled by 1e6 so every product
  // below stays an exact integer (< 2^53) and floor/remainder are exact.
  const SCALE = 1e6;
  const ints = clamped.map((v) => Math.round(v * SCALE));
  const total = ints.reduce((a, b) => a + b, 0);
  const floors = ints.map((v) => {
    const scaled = v * 100;
    return (scaled - (scaled % total)) / total;
  });
  const deficit = 100 - floors.reduce((a, b) => a + b, 0);
  const order = ints
    .map((v, i) => ({ i, rem: v * 100 - floors[i] * total }))
    .sort((a, b) => (b.rem - a.rem) || (a.i - b.i));
  const out = floors.map((f) => f / 10);
  for (let k = 0; k < deficit; k++) out[order[k % n].i] += 0.1;
  return out.map((v) => Math.round(v * 10) / 10);
}

export interface SubmitterOddsPlayerResult {
  name: string;
  competitorName: string;
  score: number;
  note: string;
}

export interface SubmitterOddsResult {
  players: SubmitterOddsPlayerResult[];
  top3: SubmitterOddsPlayerResult[];
  meta: PredictionMeta;
  cacheHit: boolean;
  generatedAt: string;
}

type CachedRun = { output_json: string; model: string; cost_usd: number; latency_ms: number; created_at: string };

function lookupCache(db: Database.Database, roundId: number, spotifyUri: string): CachedRun | undefined {
  return db.prepare(
    `SELECT output_json, model, cost_usd, latency_ms, created_at
       FROM prediction_runs
      WHERE task_id = 'submitter-odds'
        AND round_id = ?
        AND json_extract(input_json, '$.song.spotifyUri') = ?
        AND output_json IS NOT NULL AND outcome IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
  ).get(roundId, spotifyUri) as CachedRun | undefined;
}

export async function runSubmitterOdds(
  db: Database.Database,
  opts: { roundId: number; input: SubmitterOddsInput; forceRegen?: boolean },
): Promise<SubmitterOddsResult> {
  if (!opts.forceRegen) {
    const cached = lookupCache(db, opts.roundId, opts.input.song.spotifyUri);
    if (cached) {
      return assemble(opts.input, SubmitterOddsOutputSchema.parse(JSON.parse(cached.output_json)), {
        model: cached.model, costUsd: cached.cost_usd, latencyMs: cached.latency_ms, rowId: '',
      }, true, cached.created_at);
    }
  }
  const { output, meta } = await runPrediction(db, submitterOddsTask, opts.input, { roundId: opts.roundId });
  return assemble(opts.input, output, meta, false, new Date().toISOString());
}

function assemble(
  input: SubmitterOddsInput,
  output: SubmitterOddsOutput,
  meta: PredictionMeta,
  cacheHit: boolean,
  generatedAt: string,
): SubmitterOddsResult {
  const byName = new Map(output.players.map((p) => [normName(p.name), p]));
  const raw = input.players.map((p) => byName.get(normName(p.name))?.likelihood ?? 0);
  const scores = normalizeToTen(raw);
  const players: SubmitterOddsPlayerResult[] = input.players.map((p, i) => ({
    name: p.name,
    competitorName: p.competitorName,
    score: scores[i],
    note: byName.get(normName(p.name))?.note ?? '',
  }));
  const top3 = [...players]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.score - a.p.score) || (a.i - b.i))
    .slice(0, 3)
    .map(({ p }) => p);
  return { players, top3, meta, cacheHit, generatedAt };
}
