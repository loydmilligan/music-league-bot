import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';
import { listNotes, addNote, updateNote, deleteNote, notesForPrompt } from './roundNotes.js';
import { wrapNotes } from './noteEnvelope.js';

const T0 = '2026-08-26T00:00:00Z';
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO leagues (id, slug, name) VALUES (1, ?, ?)').run('bz', 'Boarz');
  db.prepare(
    `INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (149, 1, 'r149', ?, '${T0}')`,
  ).run('Surrender Monkeys');
});

describe('CRUD', () => {
  it('adds and lists a note', () => {
    addNote(db, 149, 'general', 'Kozh has been needling Jensen about the mandolin', T0);
    const all = listNotes(db, 149);
    expect(all).toHaveLength(1);
    expect(all[0].target).toBe('general');
    expect(all[0].body).toContain('mandolin');
  });

  it('lists oldest-first — the order they were observed in', () => {
    addNote(db, 149, 'general', 'first', '2026-08-24T00:00:00Z');
    addNote(db, 149, 'general', 'second', '2026-08-25T00:00:00Z');
    expect(listNotes(db, 149).map((n) => n.body)).toEqual(['first', 'second']);
  });

  it('scopes notes to their round', () => {
    db.prepare(
      `INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (150, 1, 'r150', ?, '${T0}')`,
    ).run('Next');
    addNote(db, 149, 'general', 'for 149', T0);
    expect(listNotes(db, 150)).toEqual([]);
  });

  it('updates a note body and target', () => {
    const n = addNote(db, 149, 'general', 'body', T0);
    const up = updateNote(db, n.id, { target: 'chat', body: 'edited' }, '2026-08-27T00:00:00Z');
    expect(up!.target).toBe('chat');
    expect(up!.body).toBe('edited');
    expect(up!.updatedAt).toBe('2026-08-27T00:00:00Z');
  });

  it('returns null updating an unknown note', () => {
    expect(updateNote(db, 'nope', { body: 'x' }, T0)).toBeNull();
  });

  it('deletes a note', () => {
    const n = addNote(db, 149, 'general', 'body', T0);
    expect(deleteNote(db, n.id)).toBe(true);
    expect(listNotes(db, 149)).toEqual([]);
  });

  it('rejects an unknown target', () => {
    expect(() => addNote(db, 149, 'nonsense' as never, 'x', T0)).toThrow();
  });
});

describe('notesForPrompt', () => {
  it('splits notes by target', () => {
    addNote(db, 149, 'general', 'g', T0);
    addNote(db, 149, 'chat', 'c', T0);
    addNote(db, 149, 'ledes', 'l', T0);
    const n = notesForPrompt(db, 149);
    expect(n.general.map((x) => x.body)).toEqual(['g']);
    expect(n.bySection.chat!.map((x) => x.body)).toEqual(['c']);
    expect(n.ledes.map((x) => x.body)).toEqual(['l']);
  });

  it('does not put a general note into bySection', () => {
    addNote(db, 149, 'general', 'g', T0);
    expect(notesForPrompt(db, 149).bySection).toEqual({});
  });

  it('returns empty structures for a round with no notes', () => {
    const n = notesForPrompt(db, 149);
    expect(n.general).toEqual([]);
    expect(n.ledes).toEqual([]);
    expect(n.bySection).toEqual({});
  });
});

describe('wrapNotes — the editorial envelope', () => {
  const note = (body: string) => ({ id: 'x', roundId: 149, target: 'general' as const, body, createdAt: T0, updatedAt: T0 });

  it('returns an empty string for no notes, so no stray heading is emitted', () => {
    expect(wrapNotes([])).toBe('');
  });

  it('states the note is not a quotable source', () => {
    const out = wrapNotes([note('the mandolin thing')]);
    expect(out).toMatch(/not a quotable source/i);
  });

  it('forbids attribution and chat framing', () => {
    const out = wrapNotes([note('x')]);
    expect(out).toMatch(/do not attribute/i);
    expect(out).toMatch(/said in the chat/i);
  });

  it('includes every note body verbatim', () => {
    const out = wrapNotes([note('first thing'), note('second thing')]);
    expect(out).toContain('first thing');
    expect(out).toContain('second thing');
  });
});
