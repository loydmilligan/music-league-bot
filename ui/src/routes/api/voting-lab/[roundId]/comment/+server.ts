import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getDb } from '$lib/db/client.js';
import { buildLabData } from '$lib/voting-lab/labData.js';
import { runVoteComment } from '$lib/predict/tasks/voteComment.js';
import { getVoiceSample } from '$lib/voting-lab/voiceSample.js';

const Body = z.object({ spotifyUri: z.string().min(1), forceRegen: z.boolean().optional() });

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM rounds WHERE id = ?`).get(roundId);
  if (!exists) throw error(404, 'round not found');

  const body = await request.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw error(400, parsed.error.message);

  const data = buildLabData(db, roundId);
  const row = data.rows.find((r) => r.song.spotifyUri === parsed.data.spotifyUri);
  if (!row) throw error(404, 'song not in this round');

  const result = await runVoteComment(db, {
    roundId,
    song: { title: row.song.title, artist: row.song.artist, spotifyUri: row.song.spotifyUri },
    theme: { name: data.themeName, description: data.themeDescription },
    rating: row.ballot.rating,
    notes: row.ballot.notes,
    upPoints: row.ballot.upPoints,
    downPoints: row.ballot.downPoints,
    voiceSample: getVoiceSample(db),
    forceRegen: parsed.data.forceRegen,
  });

  return json(result);
};
