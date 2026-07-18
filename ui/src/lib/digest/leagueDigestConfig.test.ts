import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { getLeagueDigestConfig } from './leagueDigestConfig.js';

let db: Database.Database;
beforeEach(() => {
  db = openLeagueDb(':memory:');
  db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1,'l','L')`).run();
});

describe('getLeagueDigestConfig', () => {
  it('defaults to off with default gen params', () => {
    const c = getLeagueDigestConfig(db, 1);
    expect(c.mode).toBe('off');
    expect(c.genParams).toBeTruthy();
  });
  it('reads a configured mode', () => {
    db.prepare(`UPDATE leagues SET digest_mode='auto' WHERE id=1`).run();
    expect(getLeagueDigestConfig(db, 1).mode).toBe('auto');
  });
  it('falls back to default gen params on malformed JSON', () => {
    db.prepare(`UPDATE leagues SET digest_gen_params='{not json' WHERE id=1`).run();
    const c = getLeagueDigestConfig(db, 1);
    expect(c.genParams).toEqual({ sections: [] });
  });
  it('parses configured gen params JSON', () => {
    db.prepare(`UPDATE leagues SET digest_gen_params=? WHERE id=1`).run(
      JSON.stringify({ sections: [{ id: 'recap' }] }),
    );
    const c = getLeagueDigestConfig(db, 1);
    expect(c.genParams).toEqual({ sections: [{ id: 'recap' }] });
  });
  it('treats an unrecognized mode value as off', () => {
    db.prepare(`UPDATE leagues SET digest_mode='bogus' WHERE id=1`).run();
    expect(getLeagueDigestConfig(db, 1).mode).toBe('off');
  });
});
