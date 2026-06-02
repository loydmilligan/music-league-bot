import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getResearchSongs, addResearchSong, updateResearchSong, deleteResearchSong } from '$lib/db/research.js';
import { getSettings } from '$lib/db/settings.js';
import { computeScore } from '$lib/scoring.js';
import { attachYtmLinks } from '$lib/db/ytmLinks.js';

export const GET: RequestHandler = async ({ params }) => {
  const db = getDb(); const settings = getSettings(db);
  const songs = getResearchSongs(db, Number(params.roundId)).map(s => ({ ...s, score: computeScore(s, settings) }));
  return json(attachYtmLinks(db, songs));
};

export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  const body = await request.json() as { spotifyUri: string; title: string; artist: string; album?: string };
  if (!body.spotifyUri || !body.title) throw error(400, 'spotifyUri and title required');
  const song = addResearchSong(db, { roundId: Number(params.roundId), ...body, album: body.album ?? null });
  return json(song, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  const body = await request.json() as { id: number; [key: string]: unknown };
  if (!body.id) throw error(400, 'id required');
  updateResearchSong(db, body.id, body as any);
  const settings = getSettings(db);
  const updated = getResearchSongs(db, Number(params.roundId)).find(s => s.id === body.id);
  return json({ ...updated, score: updated ? computeScore(updated, settings) : null });
};

export const DELETE: RequestHandler = async ({ request }) => {
  const db = getDb();
  const { id } = await request.json() as { id: number };
  deleteResearchSong(db, id);
  return new Response(null, { status: 204 });
};
