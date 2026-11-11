import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { matchForward } from '../../src/awards/match.js';

let db: Database.Database;
let n = 0;
const G = 'Test Group';

function chat(sender: string, text: string, ts: string, group = G) {
  db.prepare(
    `INSERT INTO chat_messages (id, platform, group_name, group_key, sender, text, ts, msg_hash, captured_at, sender_handle, source_path)
     VALUES (?, 'wa', ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(`c${++n}`, group, group, sender, text, ts, `h${n}`, ts);
}
function wa(id: string, authorId: string, authorName: string, snippet: string, ts: string) {
  db.prepare(`INSERT INTO wa_messages (msg_id, chat_id, chat_name, author_id, author_name, snippet, ts) VALUES (?,?,?,?,?,?,?)`).run(
    id, 'g@g.us', G, authorId, authorName, snippet, ts,
  );
}

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE chat_messages (id TEXT PRIMARY KEY, platform TEXT, group_name TEXT, group_key TEXT, sender TEXT, text TEXT, ts TEXT, msg_hash TEXT, captured_at TEXT, sender_handle TEXT, source_path TEXT);
  CREATE TABLE wa_messages (msg_id TEXT PRIMARY KEY, chat_id TEXT, chat_name TEXT, author_id TEXT, author_name TEXT, snippet TEXT, ts TEXT);`);
});

const SINCE = '2026-11-01T00:00:00.000Z';

describe('matchForward', () => {
  it('one exact hit returns a match with msgId and authorId', () => {
    chat('~ Pat Example', 'Hello   World, this is funny', '2026-11-05T12:00:00.000Z');
    wa('m1', '1555@c.us', 'Patrick Example', 'hello world, this is funny', '2026-11-05T12:00:30.000Z');
    const r = matchForward(db, '  hello world, THIS is funny ', G, SINCE);
    expect(r).toEqual([
      { who: 'Pat Example', authorId: '1555@c.us', text: 'Hello   World, this is funny', ts: '2026-11-05T12:00:00.000Z', msgId: 'm1' },
    ]);
  });

  it('null msgId/authorId when no wa_messages row is close enough', () => {
    chat('Sam Test', 'only here', '2026-11-05T12:00:00.000Z');
    wa('m1', 'x@c.us', 'Sam Test', 'only here', '2026-11-05T12:10:00.000Z');
    const r = matchForward(db, 'only here', G, SINCE);
    expect(r).toHaveLength(1);
    expect(r[0].msgId).toBeNull();
    expect(r[0].authorId).toBeNull();
  });

  it('same text twice returns two matches, oldest first', () => {
    chat('A', 'lol', '2026-11-05T12:00:00.000Z');
    chat('B', 'lol', '2026-11-04T12:00:00.000Z');
    const r = matchForward(db, 'lol', G, SINCE);
    expect(r.map((m) => m.who)).toEqual(['B', 'A']);
  });

  it('tie-breaks multiple wa candidates by author name', () => {
    chat('~ Dana Roe', 'same words here', '2026-11-05T12:00:00.000Z');
    wa('m1', 'a@c.us', 'Other Person', 'same words here', '2026-11-05T12:00:01.000Z');
    wa('m2', 'b@c.us', 'Dana Roe', 'same words here', '2026-11-05T12:01:00.000Z');
    expect(matchForward(db, 'same words here', G, SINCE)[0].msgId).toBe('m2');
  });

  it('text outside the window or in another group returns nothing', () => {
    chat('A', 'old news', '2026-10-01T12:00:00.000Z');
    chat('A', 'elsewhere', '2026-11-05T12:00:00.000Z', 'Other');
    expect(matchForward(db, 'old news', G, SINCE)).toEqual([]);
    expect(matchForward(db, 'elsewhere', G, SINCE)).toEqual([]);
  });

  it('short forward (< 20 chars) never prefix-matches', () => {
    chat('A', '😂 that is so good honestly', '2026-11-05T12:00:00.000Z');
    expect(matchForward(db, '😂', G, SINCE)).toEqual([]);
  });

  it('long forward falls back to prefix match when no exact match', () => {
    chat('A', 'this is a long message that continues past the forward', '2026-11-05T12:00:00.000Z');
    expect(matchForward(db, 'this is a long message', G, SINCE)).toHaveLength(1);
  });

  it('exact match suppresses prefix matches', () => {
    chat('A', 'this is a long message that continues', '2026-11-05T12:00:00.000Z');
    chat('B', 'this is a long message', '2026-11-05T12:05:00.000Z');
    expect(matchForward(db, 'this is a long message', G, SINCE).map((m) => m.who)).toEqual(['B']);
  });

  it('strips "~ " and non-printing characters from sender', () => {
    chat('~‎‪ Ron Example‏', 'hi there', '2026-11-05T12:00:00.000Z');
    expect(matchForward(db, 'hi there', G, SINCE)[0].who).toBe('Ron Example');
  });

  it('empty forward returns nothing', () => {
    chat('A', '', '2026-11-05T12:00:00.000Z');
    expect(matchForward(db, '   ', G, SINCE)).toEqual([]);
  });
});
