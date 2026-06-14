import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayerById } from '$lib/db/players.js';
import { runVoteProbe } from '$lib/predict/tasks/voteProbe.js';

// POST /api/players/:playerId/vote-probe
// Body: { song: { title, artist, spotify_url? }, theme: { name, description } }
// Runs the vote-probe (SAS) task and returns the result + a prediction_runs row.
export const POST: RequestHandler = async ({ params, request }) => {
  const playerId = Number(params.playerId);
  if (!playerId) throw error(400, 'invalid playerId');

  const db = getDb();
  if (!getPlayerById(db, playerId)) throw error(404, `player not found: ${playerId}`);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'request body must be valid JSON');
  }

  if (!body || typeof body !== 'object') throw error(400, 'request body must be an object');

  const { song, theme } = body as Record<string, unknown>;

  if (!song || typeof song !== 'object') throw error(400, 'body.song is required and must be an object');
  const { title, artist, spotify_url } = song as Record<string, unknown>;
  if (typeof title !== 'string' || !title.trim()) throw error(400, 'song.title must be a non-empty string');
  if (typeof artist !== 'string' || !artist.trim()) throw error(400, 'song.artist must be a non-empty string');
  if (spotify_url !== undefined && typeof spotify_url !== 'string') throw error(400, 'song.spotify_url must be a string');

  if (!theme || typeof theme !== 'object') throw error(400, 'body.theme is required and must be an object');
  const { name, description } = theme as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim()) throw error(400, 'theme.name must be a non-empty string');
  if (typeof description !== 'string') throw error(400, 'theme.description must be a string');

  const { forceRegen } = body as Record<string, unknown>;

  const { output, meta, cacheHit, generatedAt } = await runVoteProbe(db, playerId, {
    song: { title, artist, spotify_url: spotify_url as string | undefined },
    theme: { name, description },
    forceRegen: forceRegen === true,
  });

  return json({
    ...output,
    model: meta.model,
    cost_usd: meta.costUsd,
    latency_ms: meta.latencyMs,
    generated_at: generatedAt,
    cache_hit: cacheHit,
  });
};
