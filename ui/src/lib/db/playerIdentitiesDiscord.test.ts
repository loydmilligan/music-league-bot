import { describe, it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { randomUUID } from 'node:crypto';

describe('discord identity type', () => {
  it('accepts identity_type = discord after migration', () => {
    const db = openLeagueDb(`/tmp/pi-${randomUUID()}.db`);
    const p = db.prepare("INSERT INTO players (name) VALUES ('x') RETURNING id").get() as { id: number };
    expect(() =>
      db.prepare(
        "INSERT INTO player_identities (player_id, identity_type, identifier) VALUES (?, 'discord', 'Dogsweat')",
      ).run(p.id),
    ).not.toThrow();
  });
});
