import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { getEmailPollerData } from './emailPollerQuery.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE email_messages (
      message_id TEXT PRIMARY KEY, sent_at TEXT, subject TEXT, parsed_type TEXT,
      action_status TEXT, action_detail TEXT, captured_at TEXT
    );
  `);
  return db;
}

describe('getEmailPollerData', () => {
  it('returns poll:null, recent:[] on an empty DB', () => {
    expect(getEmailPollerData(freshDb())).toEqual({ poll: null, recent: [] });
  });

  it('returns nulls/empties (not throw) when tables are missing entirely', () => {
    const db = new Database(':memory:');
    expect(getEmailPollerData(db)).toEqual({ poll: null, recent: [] });
  });

  it('parses the poll status row and returns recent emails newest-first', () => {
    const db = freshDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('email_poll_status', ?)").run(
      JSON.stringify({ checkedAt: '2026-06-26T12:00:00Z', ok: true, fetched: 6, events: 2, error: null }),
    );
    const ins = db.prepare(
      "INSERT INTO email_messages (message_id, sent_at, subject, parsed_type, action_status, action_detail, captured_at) VALUES (?,?,?,?,?,?,?)",
    );
    ins.run('a', '2026-06-26T10:00:00Z', 'older', 'other', 'archived', 'archived (no action)', '2026-06-26T10:01:00Z');
    ins.run('b', '2026-06-26T11:00:00Z', 'newer', 'new_playlist', 'recorded', 'recorded voting_started · round "X" · playlist captured', '2026-06-26T11:01:00Z');

    const data = getEmailPollerData(db, 10);
    expect(data.poll?.ok).toBe(true);
    expect(data.poll?.fetched).toBe(6);
    expect(data.recent[0].subject).toBe('newer'); // newest by captured_at first
    expect(data.recent[0].actionDetail).toContain('playlist captured');
    expect(data.recent).toHaveLength(2);
  });

  it('respects the limit', () => {
    const db = freshDb();
    const ins = db.prepare("INSERT INTO email_messages (message_id, sent_at, subject, parsed_type, captured_at) VALUES (?,?,?,?,?)");
    for (let i = 0; i < 15; i++) ins.run(`m${i}`, '2026-06-26T10:00:00Z', `s${i}`, 'other', `2026-06-26T10:00:${String(i).padStart(2, '0')}Z`);
    expect(getEmailPollerData(db, 10).recent).toHaveLength(10);
  });
});
