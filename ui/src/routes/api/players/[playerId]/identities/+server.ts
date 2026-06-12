import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getPlayerById, addPlayerIdentity } from '$lib/db/players.js';

const VALID_TYPES = ['whatsapp', 'google-chat', 'music-league'] as const;

// POST /api/players/:playerId/identities — add an identity to a player.
// Body: { identity_type, identifier, league_id? }
export const POST: RequestHandler = async ({ params, request }) => {
  const playerId = Number(params.playerId);
  if (!playerId) throw error(400, 'invalid playerId');

  const db = getDb();
  if (!getPlayerById(db, playerId)) throw error(404, `player not found: ${playerId}`);

  const body = (await request.json().catch(() => ({}))) as {
    identity_type?: unknown;
    identifier?: unknown;
    league_id?: unknown;
  };

  if (!VALID_TYPES.includes(body.identity_type as (typeof VALID_TYPES)[number])) {
    throw error(400, `identity_type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  if (typeof body.identifier !== 'string' || body.identifier.trim() === '') {
    throw error(400, 'identifier must be a non-empty string');
  }
  let leagueId: number | null = null;
  if (body.league_id != null) {
    const lid = Number(body.league_id);
    if (!Number.isInteger(lid) || lid <= 0) {
      throw error(400, 'league_id must be a positive integer or omitted');
    }
    leagueId = lid;
  }

  const identity = addPlayerIdentity(db, playerId, {
    identity_type: body.identity_type as string,
    identifier: (body.identifier as string).trim(),
    league_id: leagueId,
  });

  return json(identity, { status: 201 });
};
