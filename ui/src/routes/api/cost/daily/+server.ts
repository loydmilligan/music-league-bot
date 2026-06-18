/**
 * GET /api/cost/daily?days=N  (default 14, oldest-first, zero-fill gaps)
 * Returns per-day cost breakdown by category for the last N days.
 * Queries the llm_calls UNION view.
 */
import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

export const GET: RequestHandler = ({ url }) => {
  const rawDays = url.searchParams.get('days');
  const days = Math.max(1, Math.min(365, rawDays ? Number(rawDays) : 14));
  if (Number.isNaN(days)) {
    return json({ error: 'invalid days param' }, { status: 400 });
  }

  const db = getDb();

  // Generate date range for the last N days (oldest-first)
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const rows = db.prepare(`
    SELECT date(created_at) AS day, category, SUM(cost_usd) AS total
    FROM llm_calls
    WHERE date(created_at) >= date(?)
    GROUP BY day, category
    ORDER BY day ASC
  `).all(dates[0]) as { day: string; category: string; total: number }[];

  // Build a map of day → { digest, archive, predict }
  const byDay = new Map<string, { digest: number; archive: number; predict: number }>();
  for (const row of rows) {
    if (!byDay.has(row.day)) byDay.set(row.day, { digest: 0, archive: 0, predict: 0 });
    const entry = byDay.get(row.day)!;
    const cat = row.category as 'digest' | 'archive' | 'predict';
    if (cat in entry) entry[cat] += row.total ?? 0;
  }

  // Zero-fill gaps
  const result = dates.map(date => ({
    date,
    ...(byDay.get(date) ?? { digest: 0, archive: 0, predict: 0 }),
  }));

  return json(result);
};
