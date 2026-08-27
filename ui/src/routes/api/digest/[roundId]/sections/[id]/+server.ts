import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { setLlmOutcome, editDistanceRatio } from '$lib/digest/llm.js';

function loadSection(db: ReturnType<typeof getDb>, roundId: number, sectionId: string) {
  return db
    .prepare(
      `SELECT s.* FROM digest_sections s
       JOIN digest_drafts d ON d.id = s.draft_id
       WHERE s.id = ? AND d.round_id = ?`,
    )
    .get(sectionId, roundId) as Record<string, unknown> | undefined;
}

// PATCH /api/digest/:roundId/sections/:id — manual (non-LLM) edit of a section:
// content (inline edit), variant (layout switch), state, or position. Persists
// directly to digest_sections; content edits stamp edited_at.
export const PATCH: RequestHandler = async ({ params, request }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();

  if (sectionId === "stats") {
    const draft = db.prepare("SELECT id, stats_position, stats_state, stats_content_json FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1").get(roundId) as { id: string; stats_position: number; stats_state: string; stats_content_json: string } | undefined;
    if (!draft) throw error(404, "draft not found");
    const body = (await request.json().catch(() => ({}))) as { content?: unknown; state?: unknown; position?: unknown };
    const sets: string[] = [];
    const args: unknown[] = [];
    if ("content" in body && body.content !== undefined) { sets.push("stats_content_json = ?"); args.push(JSON.stringify(body.content)); }
    if ("state" in body) {
      if (!["default", "excluded", "locked"].includes(String(body.state))) throw error(400, "invalid state");
      sets.push("stats_state = ?"); args.push(String(body.state));
    }
    if ("position" in body) {
      const pos = Number(body.position);
      if (!Number.isInteger(pos) || pos < 0) throw error(400, "invalid position");
      sets.push("stats_position = ?"); args.push(pos);
    }
    if (!sets.length) throw error(400, "no editable fields in patch");
    args.push(draft.id);
    db.prepare("UPDATE digest_drafts SET " + sets.join(", ") + " WHERE id = ?").run(...args);
    const updated = db.prepare("SELECT id, stats_position, stats_state, stats_content_json FROM digest_drafts WHERE id = ?").get(draft.id);
    return json({ ok: true, sectionId, section: updated, deterministic: true });
  }

  if (sectionId === "guesser") {
    const draft = db.prepare("SELECT id, guesser_position, guesser_state, guesser_content_json FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1").get(roundId) as { id: string; guesser_position: number; guesser_state: string; guesser_content_json: string } | undefined;
    if (!draft) throw error(404, "draft not found");
    const body = (await request.json().catch(() => ({}))) as { content?: unknown; state?: unknown; position?: unknown };
    const sets: string[] = [];
    const args: unknown[] = [];
    if ("content" in body && body.content !== undefined) { sets.push("guesser_content_json = ?"); args.push(JSON.stringify(body.content)); }
    if ("state" in body) {
      if (!["default", "excluded", "locked"].includes(String(body.state))) throw error(400, "invalid state");
      sets.push("guesser_state = ?"); args.push(String(body.state));
    }
    if ("position" in body) {
      const pos = Number(body.position);
      if (!Number.isInteger(pos) || pos < 0) throw error(400, "invalid position");
      sets.push("guesser_position = ?"); args.push(pos);
    }
    if (!sets.length) throw error(400, "no editable fields in patch");
    args.push(draft.id);
    db.prepare("UPDATE digest_drafts SET " + sets.join(", ") + " WHERE id = ?").run(...args);
    const updated = db.prepare("SELECT id, guesser_position, guesser_state, guesser_content_json FROM digest_drafts WHERE id = ?").get(draft.id);
    return json({ ok: true, sectionId, section: updated, deterministic: true });
  }

  if (sectionId === "reel") {
    const draft = db.prepare("SELECT id, reel_position, reel_state, reel_content_json FROM digest_drafts WHERE round_id = ? ORDER BY generated_at DESC LIMIT 1").get(roundId) as { id: string; reel_position: number; reel_state: string; reel_content_json: string } | undefined;
    if (!draft) throw error(404, "draft not found");
    const body = (await request.json().catch(() => ({}))) as { content?: unknown; state?: unknown; position?: unknown };
    const sets: string[] = [];
    const args: unknown[] = [];
    if ("content" in body && body.content !== undefined) { sets.push("reel_content_json = ?"); args.push(JSON.stringify(body.content)); }
    if ("state" in body) {
      if (!["default", "excluded", "locked"].includes(String(body.state))) throw error(400, "invalid state");
      sets.push("reel_state = ?"); args.push(String(body.state));
    }
    if ("position" in body) {
      const pos = Number(body.position);
      if (!Number.isInteger(pos) || pos < 0) throw error(400, "invalid position");
      sets.push("reel_position = ?"); args.push(pos);
    }
    if (!sets.length) throw error(400, "no editable fields in patch");
    args.push(draft.id);
    db.prepare("UPDATE digest_drafts SET " + sets.join(", ") + " WHERE id = ?").run(...args);
    const updated = db.prepare("SELECT id, reel_position, reel_state, reel_content_json FROM digest_drafts WHERE id = ?").get(draft.id);
    return json({ ok: true, sectionId, section: updated, deterministic: true });
  }

  const section = loadSection(db, roundId, sectionId);
  if (!section) throw error(404, `section not found: ${sectionId}`);

  const body = (await request.json().catch(() => ({}))) as {
    content?: unknown;
    variant?: unknown;
    state?: unknown;
    position?: unknown;
  };

  const sets: string[] = [];
  const args: unknown[] = [];

  // Capture prior content for edit_distance before the UPDATE (a2)
  const priorContentJson = section.content_json as string | undefined;

  if ('content' in body && body.content !== undefined) {
    // Accept the rebuilt content object; store as JSON and stamp edited_at.
    sets.push('content_json = ?', "edited_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
    args.push(JSON.stringify(body.content));
  }
  if ('variant' in body) {
    if (!['textual', 'visual', 'both'].includes(String(body.variant))) {
      throw error(400, `invalid variant: ${String(body.variant)}`);
    }
    sets.push('variant = ?');
    args.push(String(body.variant));
  }
  if ('state' in body) {
    if (!['default', 'excluded', 'locked'].includes(String(body.state))) {
      throw error(400, `invalid state: ${String(body.state)}`);
    }
    sets.push('state = ?');
    args.push(String(body.state));
  }
  if ('position' in body) {
    const pos = Number(body.position);
    if (!Number.isInteger(pos) || pos < 0) throw error(400, 'invalid position');
    sets.push('position = ?');
    args.push(pos);
  }

  if (!sets.length) throw error(400, 'no editable fields in patch');

  args.push(sectionId);
  db.prepare(`UPDATE digest_sections SET ${sets.join(', ')} WHERE id = ?`).run(...args);

  // a2: after a content edit, stamp salvaged + edit_distance on the ledger row
  if ('content' in body && body.content !== undefined) {
    let distance = 0;
    try {
      const prior = priorContentJson ? JSON.parse(priorContentJson) : {};
      distance = editDistanceRatio(prior, body.content);
    } catch { /* fallback to 0 */ }
    setLlmOutcome({
      db,
      artifactId: sectionId,
      artifactType: 'digest_section',
      outcome: 'salvaged',
      editDistance: distance,
    });
  }

  const updated = loadSection(db, roundId, sectionId);
  return json({ ok: true, sectionId, section: updated });
};

// DELETE /api/digest/:roundId/sections/:id — hard delete. Stubbed.
export const DELETE: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  const sectionId = params.id;
  if (!roundId || !sectionId) throw error(400, 'invalid params');

  const db = getDb();
  const section = loadSection(db, roundId, sectionId);
  if (!section) throw error(404, `section not found: ${sectionId}`);

  return json({ stub: true, sectionId, deleted: false });
};
