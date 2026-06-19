import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { DEFAULT_PIPELINE, ARCHIVE_DEFAULT_PIPELINE } from '$lib/digest/pipeline.js';
import type { Pipeline } from '$lib/digest/pipeline.js';

const KEY_DIGEST = 'pipeline_config';
const KEY_ARCHIVE = 'pipeline_config_archive';

type Kind = 'digest' | 'archive';

function resolveKind(url: URL): Kind {
  const raw = url.searchParams.get('kind') ?? 'digest';
  if (raw !== 'digest' && raw !== 'archive') throw error(400, `kind must be "digest" or "archive", got "${raw}"`);
  return raw;
}

function keyFor(kind: Kind): string {
  return kind === 'archive' ? KEY_ARCHIVE : KEY_DIGEST;
}

function defaultFor(kind: Kind): Pipeline {
  return kind === 'archive' ? ARCHIVE_DEFAULT_PIPELINE : DEFAULT_PIPELINE;
}

/** Structural validation for a Pipeline object (minimal — not semantic). */
function isValidPipeline(v: unknown, kind: Kind): v is Pipeline {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  if (p.releaseKind !== kind) return false;
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

// GET /api/settings/pipeline-config?kind=digest|archive → { pipeline: Pipeline }
// Returns the stored Pipeline JSON, falling back to the kind's default if unset or malformed.
// Never returns null or 404 — always produces a valid Pipeline.
export const GET: RequestHandler = ({ url }) => {
  const kind = resolveKind(url);
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(keyFor(kind)) as { value: string } | undefined;

  if (!row?.value) {
    return json({ pipeline: defaultFor(kind) });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    return json({ pipeline: defaultFor(kind) });
  }

  if (!isValidPipeline(parsed, kind)) {
    return json({ pipeline: defaultFor(kind) });
  }

  return json({ pipeline: parsed });
};

// PUT /api/settings/pipeline-config?kind=digest|archive  body: { pipeline: Pipeline }
// Validates releaseKind matches kind + persists. Returns { pipeline: Pipeline } (the saved value).
// Returns 400 if body is missing, pipeline field absent, or fails structural validation.
export const PUT: RequestHandler = async ({ request, url }) => {
  const kind = resolveKind(url);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'JSON body required');

  const { pipeline } = body;
  if (!pipeline) throw error(400, 'body.pipeline required');
  if (!isValidPipeline(pipeline, kind)) {
    throw error(400, `body.pipeline must be a valid Pipeline with releaseKind="${kind}" (releaseKind, order, models, skipAfter, covers)`);
  }

  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    keyFor(kind),
    JSON.stringify(pipeline),
  );

  // Re-parse from DB to echo the persisted value exactly.
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(keyFor(kind)) as { value: string };

  return json({ pipeline: JSON.parse(row.value) });
};
