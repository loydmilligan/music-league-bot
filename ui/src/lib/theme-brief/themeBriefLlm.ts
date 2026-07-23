import type Database from 'better-sqlite3';
import type { LlmFn } from './llmFn.js';
import type { SynthesisInput, Synthesis } from './types.js';

export function gatherComments(
  db: Database.Database,
  roundId: number,
): Array<{ title: string; points: number; comment: string }> {
  return db
    .prepare(
      `
    SELECT ms.title, v.points, v.comment
    FROM votes v JOIN ml_submissions ms ON ms.round_id = v.round_id AND ms.spotify_uri = v.spotify_uri
    WHERE v.round_id = ? AND v.comment IS NOT NULL AND v.comment <> ''
    ORDER BY v.points DESC
  `,
    )
    .all(roundId) as Array<{ title: string; points: number; comment: string }>;
}

const EMPTY: Synthesis = { winnerDna: '', cellarTraps: '', whatToSubmit: '', songLanguages: {} };

export async function synthesize(input: SynthesisInput, llm: LlmFn): Promise<Synthesis> {
  const sys = {
    role: 'system',
    content:
      'You analyze music-league theme results. Using ONLY the supplied runs (standings + vote comments), return JSON: ' +
      '{"winnerDna":"what top finishers share, 1-2 sentences","cellarTraps":"what last-place songs share, 1-2 sentences",' +
      '"whatToSubmit":"forward-looking guidance on TYPES of songs this audience rewards, 2-3 sentences",' +
      '"songLanguages":{"<spotifyUri>":"<language>"}}. Infer language per song from title/artist. ' +
      'Do not invent songs, artists, or comments that are not present in the supplied data.',
  };
  const user = { role: 'user', content: JSON.stringify(input) };
  let raw: string;
  try {
    raw = await llm([sys, user], { jsonMode: true });
  } catch {
    return EMPTY;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Synthesis>;
    return {
      winnerDna: parsed.winnerDna ?? '',
      cellarTraps: parsed.cellarTraps ?? '',
      whatToSubmit: parsed.whatToSubmit ?? '',
      songLanguages: parsed.songLanguages ?? {},
    };
  } catch {
    return EMPTY;
  }
}
