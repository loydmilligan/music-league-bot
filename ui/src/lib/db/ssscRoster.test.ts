import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openLeagueDb } from './client.js';
import { buildChatRoster } from '../digest/chatRoster.js';

// Self-contained fixture: a fresh temp DB built via openLeagueDb (which runs
// the discord CHECK-widening migration) rather than depending on a
// pre-seeded external DB copy. Mirrors what scripts/seed-sssc-roster.mjs
// produces for two of its mapped people, just enough to exercise
// buildChatRoster's resolution of a plain discord handle and the zewskers
// alias case.
const DB_PATH = join(tmpdir(), `sssc-roster-test-${randomUUID()}.db`);
let db: Database.Database;
let leagueId: number;

beforeAll(() => {
	db = openLeagueDb(DB_PATH);

	leagueId = (
		db.prepare("INSERT INTO leagues (slug, name) VALUES ('sssc', 'sssc') RETURNING id").get() as { id: number }
	).id;

	const insPlayer = db.prepare('INSERT INTO players (name, ml_competitor_id) VALUES (?, ?) RETURNING id');
	const dogsweat = (insPlayer.get('Boonie Dogsweat', 'ml-boonie-dogsweat') as { id: number }).id;
	const nowlistenallison = (insPlayer.get('nowlistenallison', 'ml-nowlistenallison') as { id: number }).id;

	const insIdent = db.prepare(
		'INSERT INTO player_identities (player_id, league_id, identity_type, identifier) VALUES (?,?,?,?)',
	);
	insIdent.run(dogsweat, leagueId, 'discord', 'Dogsweat 🚂');
	insIdent.run(nowlistenallison, leagueId, 'discord', 'zewskers');
});

afterAll(() => {
	db.close();
	unlinkSync(DB_PATH);
});

describe('sssc roster', () => {
	it('resolves mapped discord senders to players', () => {
		const roster = buildChatRoster(db, leagueId, ['Dogsweat 🚂', 'MrKlorox', 'zewskers'], 'discord', 'sssc');
		expect(roster.resolve('Dogsweat 🚂')?.unmapped).toBe(false);
		expect(roster.resolve('zewskers')?.unmapped).toBe(false); // = nowlistenallison
	});
});
