import type Database from 'better-sqlite3';
import { z } from 'zod';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';
import { modelForSection } from '../../digest/modelFor.js';

export interface VotingTakeSong {
  title: string;
  artist: string;
  spotifyPopularity: number | null;
  listeners: number | null;
  bpm: number | null;
  energy: number | null;
  hasLyrics: boolean | null;
  tags: string[];
}

export interface VotingTakeTheme {
  name: string;
  description: string;
}

export interface VotingTakeInput {
  song: VotingTakeSong;
  theme: VotingTakeTheme;
  /** The owner's taste fingerprint; '' when none is stored yet. */
  tasteFingerprint: string;
}

/**
 * Perspective only. `.strict()` is load-bearing: it makes the schema reject any
 * extra key (e.g. a smuggled-in "lean"/"recommendation"), which is how we keep
 * this from drifting into a vote recommender.
 */
export const VotingTakeOutputSchema = z.object({
  theme_read: z.string().min(1),
  taste_note: z.string().min(1),
  angles: z.array(z.string()).min(1).max(3),
  signals: z.array(z.string()),
}).strict();

export type VotingTakeOutput = z.infer<typeof VotingTakeOutputSchema>;

const VotingTakeInputSchema = z.custom<VotingTakeInput>(
  (v) =>
    v !== null && v !== undefined &&
    typeof (v as VotingTakeInput).song === 'object' &&
    typeof (v as VotingTakeInput).theme === 'object',
);

export function buildVotingTakeMessages(input: VotingTakeInput) {
  const { song, theme, tasteFingerprint } = input;
  const lines: string[] = [];

  lines.push('--- Track ---');
  lines.push(`Title: ${song.title}`);
  lines.push(`Artist: ${song.artist}`);
  if (song.spotifyPopularity !== null) lines.push(`Spotify popularity: ${song.spotifyPopularity}/100`);
  if (song.listeners !== null) lines.push(`Last.fm listeners: ${song.listeners}`);
  if (song.bpm !== null) lines.push(`BPM: ${song.bpm}`);
  if (song.energy !== null) lines.push(`Energy: ${song.energy}`);
  if (song.hasLyrics !== null) lines.push(`Has lyrics: ${song.hasLyrics ? 'yes' : 'no (instrumental)'}`);
  if (song.tags.length) lines.push(`Tags: ${song.tags.join(', ')}`);

  lines.push('\n--- Round theme ---');
  lines.push(`Name: ${theme.name}`);
  lines.push(`Description: ${theme.description}`);

  lines.push('\n--- The listener (you are writing for this person) ---');
  lines.push(tasteFingerprint || 'No taste profile on file yet.');

  return [
    {
      role: 'system' as const,
      content: `You are a sharp, opinionated music friend helping someone think about ONE track in a themed music-league round.

Your job is to give them ANGLES — interesting ways to think about this track. You are a second opinion, not a judge.

CRITICAL RULES:
- DO NOT recommend how to vote. No scores, no rankings, no "you should upvote/downvote this", no lean in any direction.
- You do not know who put this track into the round. Never guess or speculate about that.
- Be concrete about the music itself (production, arrangement, vocal delivery, lyrical angle, mood, lineage) rather than generic praise.
- "taste_note" should connect the track to the listener's stated taste honestly — including when it cuts against it.

Output a JSON object with EXACTLY these fields and no others:
{
  "theme_read": "<1-2 sentences: how this track relates to the round's theme>",
  "taste_note": "<1-2 sentences: how it sits against this listener's taste>",
  "angles": [<1-3 short, specific 'ways to think about this one'>],
  "signals": [<2-5 short descriptive tags, e.g. genre, obscurity, energy>]
}`,
    },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}

export const votingTakeTask: PredictionTask<VotingTakeInput, VotingTakeOutput> = {
  id: 'voting-take',
  inputSchema: VotingTakeInputSchema,
  buildMessages: buildVotingTakeMessages,
  model: (db) => modelForSection('voting-take', db),
  outputSchema: VotingTakeOutputSchema,
};

export interface RunVotingTakeResult {
  output: VotingTakeOutput;
  meta: PredictionMeta;
  cacheHit: boolean;
  generatedAt: string;
}

type CachedRun = { output_json: string; model: string; cost_usd: number; latency_ms: number; created_at: string };

function lookupCache(db: Database.Database, roundId: number, title: string, artist: string): CachedRun | undefined {
  return db.prepare(
    `SELECT output_json, model, cost_usd, latency_ms, created_at
     FROM prediction_runs
     WHERE task_id = 'voting-take'
       AND round_id = ?
       AND json_extract(input_json, '$.song.title') = ?
       AND json_extract(input_json, '$.song.artist') = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get(roundId, title, artist) as CachedRun | undefined;
}

export async function runVotingTake(
  db: Database.Database,
  opts: { roundId: number; song: VotingTakeSong; theme: VotingTakeTheme; tasteFingerprint: string; forceRegen?: boolean },
): Promise<RunVotingTakeResult> {
  if (!opts.forceRegen) {
    const cached = lookupCache(db, opts.roundId, opts.song.title, opts.song.artist);
    if (cached) {
      return {
        output: VotingTakeOutputSchema.parse(JSON.parse(cached.output_json)),
        meta: { model: cached.model, costUsd: cached.cost_usd, latencyMs: cached.latency_ms, rowId: '' },
        cacheHit: true,
        generatedAt: cached.created_at,
      };
    }
  }

  const input: VotingTakeInput = {
    song: opts.song, theme: opts.theme, tasteFingerprint: opts.tasteFingerprint,
  };
  const { output, meta } = await runPrediction(db, votingTakeTask, input, { roundId: opts.roundId });
  return { output, meta, cacheHit: false, generatedAt: new Date().toISOString() };
}
