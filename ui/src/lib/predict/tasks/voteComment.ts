import type Database from 'better-sqlite3';
import { z } from 'zod';
import { runPrediction } from '../predict.js';
import type { PredictionTask, PredictionMeta } from '../predict.js';
import { modelForSection } from '../../digest/modelFor.js';

export interface VoteCommentSong {
  title: string;
  artist: string;
  /**
   * Cache-key precision (Task 13 lesson): title+artist alone collides for an
   * original vs a remaster, so the cache key must include the Spotify URI.
   */
  spotifyUri: string;
}

export interface VoteCommentTheme {
  name: string;
  description: string;
}

export interface VoteCommentInput {
  song: VoteCommentSong;
  theme: VoteCommentTheme;
  rating: number | null;
  notes: string;
  upPoints: number;
  downPoints: number;
  /** The owner's past vote comments, newest first — few-shot voice examples. */
  voiceSample: string[];
}

export const VoteCommentOutputSchema = z.object({
  draft: z.string().min(1),
}).strict();

export type VoteCommentOutput = z.infer<typeof VoteCommentOutputSchema>;

const VoteCommentInputSchema = z.custom<VoteCommentInput>(
  (v) => v !== null && v !== undefined && typeof (v as VoteCommentInput).song === 'object',
);

export function buildVoteCommentMessages(input: VoteCommentInput) {
  const { song, theme, rating, notes, upPoints, downPoints, voiceSample } = input;
  const isDownvote = downPoints > 0;

  const lines: string[] = [];
  lines.push('--- Track ---');
  lines.push(`${song.artist} — "${song.title}"`);
  lines.push(`Round theme: ${theme.name} (${theme.description})`);
  lines.push(`\nMy allocation: ${isDownvote ? `DOWNVOTE (${downPoints})` : `${upPoints} up point(s)`}`);
  if (rating !== null) lines.push(`My private rating: ${rating}/5`);
  lines.push(`\nMy notes: ${notes || '(none)'}`);

  if (voiceSample.length) {
    lines.push('\n--- How I usually write vote comments (my past comments) ---');
    for (const c of voiceSample) lines.push(`- ${c}`);
  }

  return [
    {
      role: 'system' as const,
      content: `You draft a short public vote comment for a private music league, written AS the user, in the user's own voice.

Rules:
- Match the voice, length and register of the user's past comments shown below. If they are terse, be terse. If they swear, you may swear.
- Ground the comment in the user's own notes. Do not invent opinions they did not express.
- This is a public comment other league members will read. Never mention scores, points, strategy, or that it was AI-written. Never mention who submitted the track.
- ${isDownvote ? 'This is a DOWNVOTE. Be honest about why it did not land, in the user\'s voice — punchy, not cruel.' : 'This is an upvote. Say what worked.'}
- One short paragraph at most. No preamble, no sign-off.

Output a JSON object with EXACTLY this field:
{ "draft": "<the comment text>" }`,
    },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}

export const voteCommentTask: PredictionTask<VoteCommentInput, VoteCommentOutput> = {
  id: 'vote-comment',
  inputSchema: VoteCommentInputSchema,
  buildMessages: buildVoteCommentMessages,
  model: (db) => modelForSection('vote-comment', db),
  outputSchema: VoteCommentOutputSchema,
};

export interface RunVoteCommentResult {
  output: VoteCommentOutput;
  meta: PredictionMeta;
  cacheHit: boolean;
  generatedAt: string;
}

type CachedRun = { output_json: string; model: string; cost_usd: number; latency_ms: number; created_at: string };

/**
 * Cache key: round_id + spotifyUri (Task 13's collision fix) PLUS notes,
 * rating, upPoints and downPoints — every input that can change the draft's
 * content. If the user edits their notes, rating or allocation, the old row
 * simply won't match this WHERE clause and a fresh draft is generated.
 * `rating` uses `IS ?` (not `=`) because SQLite `NULL = NULL` is false.
 */
function lookupCache(
  db: Database.Database,
  roundId: number,
  spotifyUri: string,
  notes: string,
  rating: number | null,
  upPoints: number,
  downPoints: number,
): CachedRun | undefined {
  return db.prepare(
    `SELECT output_json, model, cost_usd, latency_ms, created_at
     FROM prediction_runs
     WHERE task_id = 'vote-comment'
       AND round_id = ?
       AND json_extract(input_json, '$.song.spotifyUri') = ?
       AND json_extract(input_json, '$.notes') = ?
       AND json_extract(input_json, '$.rating') IS ?
       AND json_extract(input_json, '$.upPoints') = ?
       AND json_extract(input_json, '$.downPoints') = ?
     ORDER BY created_at DESC
     LIMIT 1`,
  ).get(roundId, spotifyUri, notes, rating, upPoints, downPoints) as CachedRun | undefined;
}

/**
 * Cached-by-inputs, with a `forceRegen` escape hatch — mirrors
 * `runVotingTake`. The first "Draft" on a song is free on revisit; editing
 * notes/rating/allocation or clicking "Regenerate" always produces fresh
 * text rather than serving stale copy.
 */
export async function runVoteComment(
  db: Database.Database,
  opts: {
    roundId: number;
    song: VoteCommentSong;
    theme: VoteCommentTheme;
    rating: number | null;
    notes: string;
    upPoints: number;
    downPoints: number;
    voiceSample: string[];
    forceRegen?: boolean;
  },
): Promise<RunVoteCommentResult> {
  if (!opts.forceRegen) {
    const cached = lookupCache(
      db, opts.roundId, opts.song.spotifyUri, opts.notes, opts.rating, opts.upPoints, opts.downPoints,
    );
    if (cached) {
      return {
        output: VoteCommentOutputSchema.parse(JSON.parse(cached.output_json)),
        meta: { model: cached.model, costUsd: cached.cost_usd, latencyMs: cached.latency_ms, rowId: '' },
        cacheHit: true,
        generatedAt: cached.created_at,
      };
    }
  }

  const input: VoteCommentInput = {
    song: opts.song,
    theme: opts.theme,
    rating: opts.rating,
    notes: opts.notes,
    upPoints: opts.upPoints,
    downPoints: opts.downPoints,
    voiceSample: opts.voiceSample,
  };
  const { output, meta } = await runPrediction(db, voteCommentTask, input, { roundId: opts.roundId });
  return { output, meta, cacheHit: false, generatedAt: new Date().toISOString() };
}
