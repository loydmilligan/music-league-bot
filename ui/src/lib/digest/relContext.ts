import type Database from 'better-sqlite3';
import { callOpenRouter } from './llm.js';
import type { DigestSectionRow } from './llm.js';

export interface RelContextView {
  leagueId: number;
  context: string;
  updatedAt: string | null;
  previousContext: string | null;
  previousUpdatedAt: string | null;
  lastRoundId: number | null;
}

interface RelContextDbRow {
  league_id: number;
  text: string;
  updated_at: string | null;
  last_round_id: number | null;
  previous_text: string | null;
  previous_updated_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function getLeagueIdForRound(db: Database.Database, roundId: number): number | null {
  const row = db
    .prepare(
      `SELECT s.league_id AS league_id
       FROM rounds r JOIN seasons s ON s.id = r.season_id
       WHERE r.id = ?`,
    )
    .get(roundId) as { league_id: number } | undefined;
  return row?.league_id ?? null;
}

export function readRelContext(db: Database.Database, leagueId: number): RelContextView {
  const row = db
    .prepare(
      `SELECT league_id, text, updated_at, last_round_id, previous_text, previous_updated_at
       FROM relationship_contexts WHERE league_id = ?`,
    )
    .get(leagueId) as RelContextDbRow | undefined;
  return {
    leagueId,
    context: row?.text ?? '',
    updatedAt: row?.updated_at ?? null,
    previousContext: row?.previous_text ?? null,
    previousUpdatedAt: row?.previous_updated_at ?? null,
    lastRoundId: row?.last_round_id ?? null,
  };
}

// Upsert with prior-value snapshot. The current (text, updated_at) is moved to
// (previous_text, previous_updated_at) before the new values are written. This
// is the only writer; both /finalize (LLM update) and PATCH (manual override)
// flow through it so the diff invariant holds for both code paths.
export function upsertRelContext(
  db: Database.Database,
  leagueId: number,
  newContext: string,
  lastRoundId: number | null,
): RelContextView {
  const ts = nowIso();
  const existing = db
    .prepare('SELECT text, updated_at FROM relationship_contexts WHERE league_id = ?')
    .get(leagueId) as { text: string; updated_at: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE relationship_contexts
         SET previous_text = text,
             previous_updated_at = updated_at,
             text = ?,
             updated_at = ?,
             last_round_id = COALESCE(?, last_round_id)
       WHERE league_id = ?`,
    ).run(newContext, ts, lastRoundId, leagueId);
  } else {
    db.prepare(
      `INSERT INTO relationship_contexts
         (league_id, text, updated_at, last_round_id, previous_text, previous_updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
    ).run(leagueId, newContext, ts, lastRoundId);
  }
  return readRelContext(db, leagueId);
}

function buildRelContextSystemPrompt(): string {
  return `You maintain a private "relationship context" document for a small music league.
The document captures recurring people, dynamics, running jokes, taste profiles, and any
patterns that help the editorial voice write subsequent digests with continuity.

You will receive (a) the current document and (b) the finalized digest of the round that
just shipped. Produce an updated document that integrates anything genuinely new — new
in-jokes, shifts in voting alliances, emerging taste profiles, recurring villains/heroes.

Rules:
- Keep what still applies. Do not rewrite for style; preserve the existing voice.
- Add, don't restate. New material should be additive paragraphs or bullets.
- Drop only things that have been contradicted by the new round.
- Keep it under ~600 words. If it grows past that, compress oldest material.
- If the round adds nothing new, return the existing document verbatim.

Return ONE JSON object: {"updated_context": "<the full updated document as a single string>"}`;
}

function sectionsToMarkdown(sections: DigestSectionRow[]): string {
  const parts: string[] = [];
  for (const s of sections) {
    if (s.state === 'excluded') continue;
    let content: unknown;
    try { content = JSON.parse(s.content_json); } catch { content = s.content_json; }
    parts.push(`## ${s.kind}\n${typeof content === 'string' ? content : JSON.stringify(content, null, 2)}`);
  }
  return parts.join('\n\n');
}

export async function proposeRelContextUpdate(
  previousContext: string,
  sections: DigestSectionRow[],
  roundName: string,
): Promise<string> {
  const userPrompt = [
    `# Current relationship context`,
    previousContext.trim() || '(empty — this is the first round being digested for this league)',
    '',
    `# Finalized digest just shipped (round: ${roundName})`,
    sectionsToMarkdown(sections),
  ].join('\n');

  const { content: raw } = await callOpenRouter(
    [
      { role: 'system', content: buildRelContextSystemPrompt() },
      { role: 'user', content: userPrompt },
    ],
    { jsonMode: true },
  );
  const parsed = JSON.parse(raw) as { updated_context?: unknown };
  if (typeof parsed.updated_context !== 'string') {
    throw new Error('LLM response missing string "updated_context"');
  }
  return parsed.updated_context;
}
