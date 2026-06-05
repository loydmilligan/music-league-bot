import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getDiscoverability } from '$lib/db/discoverability.js';

// GET /api/digest/:roundId/discoverability
//   → { discoverability: TastemakerPayload | null }  (sprint-18 v2)
// TastemakerPayload = { scope:'season', season, players:[{ name, rank, prevRank,
//   tastemakerScore (median percentile), avgPoints, submissionCount,
//   buckets:{radioHit,recognizable,curiousCut,rabbitHole}, songs:[{round,artist,
//   title,obscurity,discoveryPercentile,bucket,points}] }] }.
// Ranked most-obscure (highest tastemakerScore) first; null on absent/partial coverage.
export const GET: RequestHandler = ({ params }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');
  const db = getDb();
  if (!db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId)) throw error(404, `round not found: ${roundId}`);
  return json({ discoverability: getDiscoverability(db, roundId) });
};
