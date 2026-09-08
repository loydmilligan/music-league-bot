import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { ensurePlaylistSchema, pageForSlug, pageRoster } from '$lib/ytm/playlistVotes.js';

/**
 * POST /api/p/<slug>/identity  { playerId }
 *
 * The page keeps identity in localStorage and is authoritative about it; this
 * exists only so a claim is validated against the round's roster before the
 * page starts attributing votes to it. It stores nothing — there is no server
 * side to a claim nobody authenticates.
 *
 * It matters anyway: without it a page could hold a playerId from another
 * league (or a typo) and every subsequent write would fail one at a time, with
 * the user seeing an error strip per vote instead of once, at the point they
 * chose.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const db = getDb();
  ensurePlaylistSchema(db);
  const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
  // Not authorizeWrite(): that one is video-scoped, and a claim of identity is
  // not about any particular video. Same 404-for-unknown-slug discipline
  // though — a bad slug must not be distinguishable from a bad player.
  const page = pageForSlug(db, params.slug);
  if (!page) return json({ ok: false, reason: 'no such page' }, { status: 404 });
  const player = pageRoster(db, page.roundId).find((p) => p.id === body.playerId);
  if (!player) return json({ ok: false, reason: 'not on this round’s roster' }, { status: 400 });
  return json({ ok: true, player: { id: player.id, name: player.name } });
};
