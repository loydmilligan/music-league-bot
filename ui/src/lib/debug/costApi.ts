/**
 * costApi.ts — fetch helpers for the cost dashboard endpoints.
 * Sprint-39 endpoints are live; this module calls them directly.
 * Types mirror the contract in sprint-40-cost-dashboard.md.
 */

export interface DaySummary {
  digest: number;
  archive: number;
  predict: number;
  avatar: number;
  total: number;
}

export interface DailyCost {
  date: string;
  digest: number;
  archive: number;
  predict: number;
  avatar: number;
}

export type CostCategory = 'digest' | 'archive' | 'predict' | 'avatar';

export interface CostCall {
  ts: string;
  model: string;
  category: CostCategory;
  label: string;
  cost_usd: number;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

/**
 * Fetch today's cost summary by category.
 * Optionally pass a date string (YYYY-MM-DD); defaults to today on the server.
 */
export async function fetchCostSummary(date?: string): Promise<DaySummary> {
  const url = date ? `/api/cost/summary?date=${encodeURIComponent(date)}` : '/api/cost/summary';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`/api/cost/summary ${r.status}`);
  return r.json() as Promise<DaySummary>;
}

/**
 * Fetch per-day cost breakdown for the last N days (oldest-first).
 * Default: 14 days.
 */
export async function fetchCostDaily(days = 14): Promise<DailyCost[]> {
  const r = await fetch(`/api/cost/daily?days=${days}`);
  if (!r.ok) throw new Error(`/api/cost/daily ${r.status}`);
  return r.json() as Promise<DailyCost[]>;
}

/**
 * Fetch individual LLM call records for a date (newest-first, cap 500).
 * Optionally pass a date string; defaults to today.
 */
export async function fetchCostCalls(date?: string): Promise<CostCall[]> {
  const url = date ? `/api/cost/calls?date=${encodeURIComponent(date)}` : '/api/cost/calls';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`/api/cost/calls ${r.status}`);
  return r.json() as Promise<CostCall[]>;
}
