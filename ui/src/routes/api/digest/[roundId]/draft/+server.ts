import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  gatherRoundData,
  generateDraft,
  getActiveDraftForRound,
  getSectionsForDraft,
  writeDraft,
  enrichPodiumArt,
  SECTION_KINDS,
  type GenParams,
  type GenSectionParam,
  type SectionKind,
} from '$lib/digest/llm.js';
import { getStandings } from '$lib/db/standings.js';
import { ensureAlbumArt } from '$lib/digest/albumArt.js';

// POST /api/digest/:roundId/draft
// No body / empty body  → cached: returns the existing draft if one exists,
//                         otherwise generates a default draft.
// Generation-params body → forces a fresh generation honoring the modal's
//   per-section { enabled, style, variant, context } + pastedChat, replacing
//   any existing draft for the round.
//   Body: { sections?: [{id, enabled, style, variant, context}], pastedChat? }
export const POST: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  if (!roundId) throw error(400, 'invalid roundId');

  const db = getDb();
  const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(roundId);
  if (!round) throw error(404, `round not found: ${roundId}`);

  const genParams = parseGenParams(await readBody(request));

  // Resolve + cache per-song album art (sprint-15 podium-thumbnails). Best-effort:
  // a Spotify failure must not block generation — the podium falls back to glyphs.
  try {
    await ensureAlbumArt(db, roundId);
  } catch (e) {
    console.error('[draft] ensureAlbumArt failed:', (e as Error).message);
  }

  // Standings payload + gen-time reconcile (computed-from-votes vs stored gospel).
  // Surfaced on every draft response so the digest renders from the table and
  // viz can pop the reconciliation modal on a mismatch.
  const standings = getStandings(db, roundId);

  const cached = getActiveDraftForRound(db, roundId);
  // Cached path only when the caller did NOT supply generation params — a
  // params request always (re)generates so the modal's choices take effect.
  if (cached && !genParams) {
    // Backfill album art into an already-generated podium (older drafts predate
    // podium-thumbnails) without regenerating prose — additive coverUrl only.
    const sections = backfillPodiumArt(db, roundId, getSectionsForDraft(db, cached.id));
    return json({
      cached: true,
      draft: cached,
      sections,
      standings: standings.standings,
      reconcile: standings.reconcile,
    });
  }

  const data = gatherRoundData(db, roundId);
  let output;
  try {
    output = await generateDraft(data, genParams ?? undefined);
  } catch (e) {
    throw error(502, `LLM draft failed: ${(e as Error).message}`);
  }

  // A params-driven regeneration replaces prior drafts for this round so the
  // active draft cleanly reflects the latest modal choices (sections cascade).
  if (genParams) {
    db.prepare('DELETE FROM digest_drafts WHERE round_id = ?').run(roundId);
  }

  const { draft, sections } = writeDraft(
    db, roundId, data, output, { generated_via: 'POST /draft', genParams: genParams ?? null }, genParams ?? undefined,
  );

  return json({
    cached: false,
    draft,
    sections,
    standings: standings.standings,
    reconcile: standings.reconcile,
  });
};

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

type SectionRow = ReturnType<typeof getSectionsForDraft>[number];

// Enrich an existing cached draft's podium section with album art (additive)
// and persist if it changed. Returns the (possibly updated) section list.
function backfillPodiumArt(db: ReturnType<typeof getDb>, roundId: number, sections: SectionRow[]): SectionRow[] {
  const podium = sections.find((s) => s.kind === 'podium');
  if (!podium) return sections;
  let content: unknown;
  try {
    content = JSON.parse(podium.content_json);
  } catch {
    return sections;
  }
  const before = JSON.stringify(content);
  const subs = gatherRoundData(db, roundId).submissions;
  enrichPodiumArt(content, subs);
  const after = JSON.stringify(content);
  if (after === before) return sections;
  db.prepare('UPDATE digest_sections SET content_json = ? WHERE id = ?').run(after, podium.id);
  return sections.map((s) => (s.id === podium.id ? { ...s, content_json: after } : s));
}

// Returns a GenParams object only when the body carries meaningful generation
// params; otherwise null (→ cached default behavior).
function parseGenParams(body: unknown): GenParams | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { sections?: unknown; pastedChat?: unknown };
  const hasSections = Array.isArray(b.sections) && b.sections.length > 0;
  const hasPasted = typeof b.pastedChat === 'string' && b.pastedChat.trim().length > 0;
  if (!hasSections && !hasPasted) return null;

  const validKinds = new Set<string>(SECTION_KINDS);
  const sections: GenSectionParam[] = (Array.isArray(b.sections) ? b.sections : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .filter((s) => validKinds.has(String((s as { id: unknown }).id)))
    .map((s) => ({
      id: String((s as { id: unknown }).id) as SectionKind,
      enabled: (s as { enabled?: unknown }).enabled === undefined ? true : !!(s as { enabled?: unknown }).enabled,
      style: Array.isArray((s as { style?: unknown }).style)
        ? ((s as { style: unknown[] }).style.filter((x) => typeof x === 'string') as string[])
        : undefined,
      variant: normalizeVariant((s as { variant?: unknown }).variant),
      context: typeof (s as { context?: unknown }).context === 'string' ? (s as { context: string }).context : undefined,
    }));

  return {
    sections,
    pastedChat: hasPasted ? String(b.pastedChat) : undefined,
  };
}

function normalizeVariant(v: unknown): 'textual' | 'visual' | 'both' | undefined {
  return v === 'textual' || v === 'visual' || v === 'both' ? v : undefined;
}
