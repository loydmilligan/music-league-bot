import type { Actions, PageServerLoad } from './$types.js';
import { error, fail } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';

// ── HiL lede review · Digest Quality Program WS10 ────────────────────────────
// The round-end pipeline stores candidate story ledes in `digest_ledes`
// (scripts/digest-qa/generate_ledes.py) and ntfy links Matt here. He rates
// each lede (love / keep / kill) and can leave free-text direction; the
// punch-up pass consumes `ratings_json`.

export type Lede = { id: string; title: string; angle: string; evidence: string[] };
export type Ratings = { ratings: Record<string, string>; notes: string; saved_at: string };

export const load: PageServerLoad = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isFinite(roundId)) throw error(404, 'bad round id');
  const db = getDb();

  const round = db
    .prepare('SELECT id, name FROM rounds WHERE id = ?')
    .get(roundId) as { id: number; name: string } | undefined;
  if (!round) throw error(404, 'unknown round');

  // The ledes table is created by the generator script; tolerate its absence
  // so this page can ship ahead of the first generated round.
  let ledes: Lede[] = [];
  let ratings: Ratings | null = null;
  let generatedAt: string | null = null;
  try {
    const row = db
      .prepare('SELECT content_json, ratings_json, generated_at FROM digest_ledes WHERE round_id = ?')
      .get(roundId) as { content_json: string; ratings_json: string | null; generated_at: string } | undefined;
    if (row) {
      const content = JSON.parse(row.content_json) as { ledes?: Lede[] };
      ledes = Array.isArray(content.ledes) ? content.ledes : [];
      ratings = row.ratings_json ? (JSON.parse(row.ratings_json) as Ratings) : null;
      generatedAt = row.generated_at;
    }
  } catch {
    // table missing or malformed JSON → render the empty state
  }

  return { round, ledes, ratings, generatedAt };
};

export const actions: Actions = {
  save: async ({ params, request }) => {
    const roundId = Number(params.roundId);
    const db = getDb();
    const form = await request.formData();

    const ratings: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith('rating:') && typeof value === 'string' && value) {
        ratings[key.slice('rating:'.length)] = value;
      }
    }
    const notes = String(form.get('notes') ?? '').trim();
    const payload: Ratings = { ratings, notes, saved_at: new Date().toISOString() };

    const res = db
      .prepare('UPDATE digest_ledes SET ratings_json = ? WHERE round_id = ?')
      .run(JSON.stringify(payload), roundId);
    if (res.changes !== 1) return fail(404, { message: 'no ledes row for this round' });
    return { saved: true };
  },
};
