import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { readCachedBrief, buildThemeBrief } from '$lib/theme-brief/assemble.js';
import { makeLlmFn } from '$lib/theme-brief/llmFn.js';

export const GET: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const brief = readCachedBrief(getDb(), roundId);
  return brief ? json({ generated: true, brief }) : json({ generated: false });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const db = getDb();
  if (!body.force) {
    const cached = readCachedBrief(db, roundId);
    if (cached) return json({ brief: cached });
  }
  try {
    const brief = await buildThemeBrief(db, roundId, makeLlmFn(db, 'theme-brief'));
    return json({ brief });
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      throw error(404, `round not found: ${roundId}`);
    }
    throw err;
  }
};
