import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { callOpenRouter } from '$lib/digest/llm.js';
import { generateEarlyLedes, getEarlyLedes, saveEarlyLedeRatings } from '$lib/digest/earlyLedes.js';

const roundOf = (params: { roundId: string }): number => {
  const n = Number(params.roundId);
  if (!Number.isInteger(n) || n <= 0) throw error(400, 'invalid roundId');
  return n;
};

export const GET: RequestHandler = ({ params }) =>
  json({ sheet: getEarlyLedes(getDb(), roundOf(params as { roundId: string })) });

// On demand only — never scheduled. Each call costs one LLM call, and the
// sheet is only worth having when there is time to look at it.
export const POST: RequestHandler = async ({ params }) => {
  const roundId = roundOf(params as { roundId: string });
  const out = await generateEarlyLedes(getDb(), roundId, {
    call: callOpenRouter, now: () => new Date().toISOString(),
  });
  return json(out);
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = roundOf(params as { roundId: string });
  const { ratings } = (await request.json()) as { ratings?: unknown };
  if (ratings === undefined) throw error(400, 'ratings is required');
  if (!saveEarlyLedeRatings(getDb(), roundId, ratings, new Date().toISOString())) {
    throw error(404, 'no early lede sheet for this round');
  }
  return json({ ok: true });
};
