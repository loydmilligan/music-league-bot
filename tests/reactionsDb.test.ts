import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dir = mkdtempSync(join(tmpdir(), 'reactions-'));
process.env.DATA_DIR = dir;

const { recordSeenMessage, recordReaction } = await import('../src/storage/reactionsDb.js');
const read = () =>
  new Database(join(dir, 'league.db')).prepare('SELECT * FROM chat_reactions ORDER BY reactor_id').all() as Record<string, unknown>[];

describe('reactionsDb', () => {
  beforeAll(() => {
    recordSeenMessage({ msgId: 'm1', chatId: 'g@g.us', chatName: 'Boarz', authorId: 'alice@lid', authorName: 'Alice', text: 'the joke', ts: '2026-10-15T00:00:00Z' });
  });

  it('credits the reacted message author and names a reactor once they speak', () => {
    recordReaction({ targetMsgId: 'm1', chatId: 'g@g.us', reactorId: 'bob@lid', reaction: '😂', ts: '2026-10-15T00:01:00Z' });
    let row = read()[0];
    expect(row).toMatchObject({ group_name: 'Boarz', target_author_name: 'Alice', target_snippet: 'the joke', reactor_name: null, reaction: '😂' });
    recordSeenMessage({ msgId: 'm2', chatId: 'g@g.us', chatName: 'Boarz', authorId: 'bob@lid', authorName: 'Bob', text: 'hi', ts: '2026-10-15T00:02:00Z' });
    row = read()[0];
    expect(row.reactor_name).toBe('Bob');
  });

  it('replaces a changed reaction and marks a removed one', () => {
    recordReaction({ targetMsgId: 'm1', chatId: 'g@g.us', reactorId: 'bob@lid', reaction: '👍', ts: '2026-10-15T00:03:00Z' });
    expect(read()).toHaveLength(1);
    expect(read()[0]).toMatchObject({ reaction: '👍', removed: 0 });
    recordReaction({ targetMsgId: 'm1', chatId: 'g@g.us', reactorId: 'bob@lid', reaction: '', ts: '2026-10-15T00:04:00Z' });
    expect(read()[0]).toMatchObject({ reaction: '👍', removed: 1 });
  });
});
