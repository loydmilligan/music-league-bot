/**
 * Durable per-round editor notes.
 *
 * Distinct from GenerateModal's per-section `context`, which is one-off
 * steering typed at the instant of generation. A note is something observed
 * days earlier. Conflating them would lose one of the two jobs.
 *
 * Notes are per-round and do not carry forward — cross-round continuity is the
 * bridge's job and it already does it.
 */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SECTION_KINDS, type SectionKind } from './llm.js';

export type NoteTarget = 'general' | SectionKind | 'ledes';

export type RoundNote = {
  id: string; roundId: number; target: NoteTarget; body: string;
  createdAt: string; updatedAt: string;
};

const TARGETS = new Set<string>(['general', 'ledes', ...SECTION_KINDS]);

export function isNoteTarget(v: unknown): v is NoteTarget {
  return typeof v === 'string' && TARGETS.has(v);
}

type Row = { id: string; round_id: number; target: string; body: string; created_at: string; updated_at: string };
const hydrate = (r: Row): RoundNote => ({
  id: r.id, roundId: r.round_id, target: r.target as NoteTarget,
  body: r.body, createdAt: r.created_at, updatedAt: r.updated_at,
});

/** Oldest-first: the order the editor observed them in. */
export function listNotes(db: Database.Database, roundId: number): RoundNote[] {
  return (db.prepare(
    'SELECT * FROM round_notes WHERE round_id = ? ORDER BY created_at, id',
  ).all(roundId) as Row[]).map(hydrate);
}

export function addNote(
  db: Database.Database, roundId: number, target: NoteTarget, body: string, nowIso: string,
): RoundNote {
  if (!isNoteTarget(target)) throw new Error(`unknown note target "${target}"`);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO round_notes (id, round_id, target, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, roundId, target, body, nowIso, nowIso);
  return { id, roundId, target, body, createdAt: nowIso, updatedAt: nowIso };
}

export function updateNote(
  db: Database.Database, id: string,
  patch: { target?: NoteTarget; body?: string }, nowIso: string,
): RoundNote | null {
  const row = db.prepare('SELECT * FROM round_notes WHERE id = ?').get(id) as Row | undefined;
  if (!row) return null;
  if (patch.target !== undefined && !isNoteTarget(patch.target)) {
    throw new Error(`unknown note target "${patch.target}"`);
  }
  const target = patch.target ?? (row.target as NoteTarget);
  const body = patch.body ?? row.body;
  db.prepare('UPDATE round_notes SET target = ?, body = ?, updated_at = ? WHERE id = ?')
    .run(target, body, nowIso, id);
  return { id, roundId: row.round_id, target, body, createdAt: row.created_at, updatedAt: nowIso };
}

export function deleteNote(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM round_notes WHERE id = ?').run(id).changes === 1;
}

export type PromptNotes = {
  general: RoundNote[];
  bySection: Partial<Record<SectionKind, RoundNote[]>>;
  ledes: RoundNote[];
};

/**
 * Group a round's notes by where they are allowed to go.
 *
 * `general` is NOT duplicated into bySection — callers append both, so
 * duplicating here would put the same note in a section prompt twice.
 */
export function notesForPrompt(db: Database.Database, roundId: number): PromptNotes {
  const out: PromptNotes = { general: [], bySection: {}, ledes: [] };
  for (const n of listNotes(db, roundId)) {
    if (n.target === 'general') out.general.push(n);
    else if (n.target === 'ledes') out.ledes.push(n);
    else (out.bySection[n.target] ??= []).push(n);
  }
  return out;
}
