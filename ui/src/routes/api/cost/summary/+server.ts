/**
 * GET /api/cost/summary?date=YYYY-MM-DD
 * Returns total USD cost grouped by category for the given date (default: today).
 * Queries the llm_calls UNION view (never base tables directly).
 */
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

export const GET: RequestHandler = ({ url }) => {
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  const db = getDb();
  const rows = db.prepare(`
    SELECT category, SUM(cost_usd) AS total
    FROM llm_calls
    WHERE date(created_at) = date(?)
    GROUP BY category
  `).all(date) as { category: string; total: number }[];

  const result = { digest: 0, archive: 0, predict: 0, avatar: 0, total: 0 };
  for (const row of rows) {
    const cat = row.category as 'digest' | 'archive' | 'predict' | 'avatar';
    if (cat in result) result[cat] += row.total ?? 0;
    result.total += row.total ?? 0;
  }

  return json(result);
};
