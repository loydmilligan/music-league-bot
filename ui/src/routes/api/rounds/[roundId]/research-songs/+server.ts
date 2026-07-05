import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { requireBearerToken } from '$lib/auth/bearer.js';
import { addSongToRoundWithShortlistCascade } from '$lib/db/researchCascade.js';

// POST /api/rounds/:roundId/research-songs — add a song to a round's active
// research list, cascading into the global shortlist. New route (Phase 1
// MCP); requires a bearer token per this project's auth convention.
export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  requireBearerToken(request, db);

  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  if (!db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId)) throw error(404, `round not found: ${roundId}`);

  const body = (await request.json().catch(() => null)) as {
    spotifyUri?: string; title?: string; artist?: string; album?: string;
    notes?: string;
    ratings?: { discoveryPotential?: number; themeFit?: number; quality?: number; replayability?: number };
  } | null;
  if (!body?.spotifyUri || !body.title || !body.artist) {
    throw error(400, 'spotifyUri, title, and artist required');
  }

  const result = addSongToRoundWithShortlistCascade(db, {
    roundId, spotifyUri: body.spotifyUri, title: body.title, artist: body.artist,
    album: body.album, notes: body.notes, ratings: body.ratings,
  });

  return json(result, { status: 201 });
};
