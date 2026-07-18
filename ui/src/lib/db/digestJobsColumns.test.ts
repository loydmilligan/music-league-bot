import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from './schema.js';

describe('digest_jobs approval columns', () => {
  it('fresh schema has the approval + attempts columns', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA);
    const cols = (db.prepare("PRAGMA table_info(digest_jobs)").all() as { name: string }[]).map((c) => c.name);
    for (const c of ['approval_token', 'decision', 'decided_at', 'review_url', 'attempts']) {
      expect(cols).toContain(c);
    }
  });
});
