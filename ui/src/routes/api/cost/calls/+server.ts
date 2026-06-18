/**
 * GET /api/cost/calls?date=YYYY-MM-DD  (default: today, newest-first, cap 500)
 * Returns individual LLM call records for the given date.
 * Queries the llm_calls UNION view.
 */
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

export const GET: RequestHandler = ({ url }) => {
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  const db = getDb();
  const rows = db.prepare(`
    SELECT
      created_at AS ts,
      model,
      category,
      label,
      cost_usd,
      latency_ms,
      prompt_tokens,
      completion_tokens
    FROM llm_calls
    WHERE date(created_at) = date(?)
    ORDER BY created_at DESC
    LIMIT 500
  `).all(date) as {
    ts: string;
    model: string;
    category: string;
    label: string;
    cost_usd: number;
    latency_ms: number;
    prompt_tokens: number;
    completion_tokens: number;
  }[];

  return json(rows);
};
