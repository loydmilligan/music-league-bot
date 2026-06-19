import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { DEFAULT_PIPELINE } from '$lib/digest/pipeline.js';
import type { Pipeline } from '$lib/digest/pipeline.js';

const KEY_SETTING = 'pipeline_config';

/** Structural validation for a Pipeline object (minimal — not semantic). */
function isValidPipeline(v: unknown): v is Pipeline {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  if (p.releaseKind !== 'digest') return false;
  if (!Array.isArray(p.order) || p.order.length === 0) return false;
  if (!p.models || typeof p.models !== 'object' || Array.isArray(p.models)) return false;
  if (!p.skipAfter || typeof p.skipAfter !== 'object' || Array.isArray(p.skipAfter)) return false;
  if (!Array.isArray(p.covers)) return false;
  for (const cover of p.covers as unknown[]) {
    if (!cover || typeof cover !== 'object' || Array.isArray(cover)) return false;
    const c = cover as Record<string, unknown>;
    if (typeof c.of !== 'string' || typeof c.model !== 'string') return false;
  }
  return true;
}

// GET /api/settings/pipeline-config → { pipeline: Pipeline }
// Returns the stored Pipeline JSON, falling back to DEFAULT_PIPELINE if unset or malformed.
// Never returns null or 404 — always produces a valid Pipeline.
export const GET: RequestHandler = () => {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(KEY_SETTING) as { value: string } | undefined;

  if (!row?.value) {
    return json({ pipeline: DEFAULT_PIPELINE });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return json({ pipeline: DEFAULT_PIPELINE });
  }

  if (!isValidPipeline(parsed)) {
    return json({ pipeline: DEFAULT_PIPELINE });
  }

  return json({ pipeline: parsed });
};

// PUT /api/settings/pipeline-config  body: { pipeline: Pipeline }
// Validates + persists the pipeline. Returns { pipeline: Pipeline } (the saved value).
// Returns 400 if body is missing, pipeline field absent, or fails structural validation.
export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const { pipeline } = body;
  if (!pipeline) throw error(400, 'body.pipeline required');
  if (!isValidPipeline(pipeline)) {
    throw error(400, 'body.pipeline must be a valid Pipeline (releaseKind, order, models, skipAfter, covers)');
  }

  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    KEY_SETTING,
    JSON.stringify(pipeline),
  );

  // Re-parse from DB to echo the persisted value exactly.
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(KEY_SETTING) as { value: string };

  return json({ pipeline: JSON.parse(row.value) });
};
