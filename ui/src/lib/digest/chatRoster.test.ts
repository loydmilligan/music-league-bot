import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildChatRoster, normalizeSender, displayName } from './chatRoster';

describe('normalizeSender', () => {
	it('folds the relay tilde, including the narrow no-break space', () => {
		expect(normalizeSender('~ Conor J')).toBe('conor j');
		expect(normalizeSender('~ Conor J')).toBe('conor j');
		expect(normalizeSender('Conor J')).toBe('conor j');
	});

	it('matches identifiers stored with or without the tilde', () => {
		// player_identities holds both forms; normalising makes that irrelevant.
		expect(normalizeSender('~ Darren')).toBe(normalizeSender('Darren'));
	});
});

describe('displayName', () => {
	it('drops the tilde so an unmapped sender still reads as a name', () => {
		expect(displayName('~ Tj')).toBe('Tj');
		expect(displayName('Phil Chapin')).toBe('Phil Chapin');
	});
});

describe('buildChatRoster', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		db.exec(`
			CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
			CREATE TABLE player_identities (
				id INTEGER PRIMARY KEY, player_id INTEGER, league_id INTEGER,
				identity_type TEXT, identifier TEXT
			);
			INSERT INTO players (id,name) VALUES
				(1,'Matt Mariani'),(4,'Jon Black'),(6,'TJ Cook'),
				(33,'Dave Steingart'),(34,'Dave Jensen'),(32,'Conor Johnston');
			INSERT INTO player_identities (player_id,league_id,identity_type,identifier) VALUES
				-- Boarz (league 5)
				(32,5,'whatsapp','~ Conor J'),
				(33,5,'whatsapp','~ Dave'),
				(1,5,'whatsapp','Matt Mariani'),
				-- Second Best (league 3)
				(6,3,'whatsapp','Tj Cook'),
				(4,3,'whatsapp','Jon Black'),
				(1,3,'whatsapp','Matt Mariani');
		`);
	});

	it('resolves a league its own people', () => {
		const r = buildChatRoster(db, 5);
		expect(r.resolve('~ Conor J')?.name).toBe('Conor Johnston');
		expect(r.resolve('~ Conor J')?.unmapped).toBe(false);
	});

	it('keeps leagues isolated — one league cannot resolve another roster', () => {
		const boarz = buildChatRoster(db, 5);
		const secondBest = buildChatRoster(db, 3);
		// Conor is Boarz-only; TJ is Second-Best-only.
		expect(boarz.resolve('~ Conor J')?.name).toBe('Conor Johnston');
		expect(secondBest.resolve('~ Conor J')).toBeNull();
		expect(secondBest.resolve('Tj Cook')?.name).toBe('TJ Cook');
		expect(boarz.resolve('Tj Cook')).toBeNull();
	});

	it('resolves someone in both leagues under each league separately', () => {
		// Matt is in both. Each league looks him up through its own row, so his
		// presence never drags one league's roster into the other.
		expect(buildChatRoster(db, 5).resolve('Matt Mariani')?.name).toBe('Matt Mariani');
		expect(buildChatRoster(db, 3).resolve('Matt Mariani')?.name).toBe('Matt Mariani');
	});

	it('trusts player_identities over a guess about who "~ Dave" is', () => {
		// The hardcoded roster guessed Dave Jensen; the table says Steingart.
		expect(buildChatRoster(db, 5).resolve('~ Dave')?.name).toBe('Dave Steingart');
	});

	it('never drops an unmapped sender — it counts them under their own name', () => {
		const r = buildChatRoster(db, 3, ['~ bp', '~ Philip', 'Jon Black']);
		expect(r.resolve('~ bp')?.name).toBe('bp');
		expect(r.resolve('~ bp')?.unmapped).toBe(true);
		expect(r.resolve('~ bp')?.playerId).toBeNull();
		expect(r.unmapped).toEqual(['~ bp', '~ Philip']);
	});

	it('ignores group-event pseudo-senders', () => {
		const r = buildChatRoster(db, 5, ['Mentioned all']);
		expect(r.resolve('Mentioned all')).toBeNull();
		expect(r.unmapped).not.toContain('Mentioned all');
	});

	it('includes global identities that are not tied to a league', () => {
		db.prepare(
			`INSERT INTO player_identities (player_id,league_id,identity_type,identifier)
			 VALUES (34,NULL,'whatsapp','~ David Jensen')`,
		).run();
		expect(buildChatRoster(db, 5).resolve('~ David Jensen')?.name).toBe('Dave Jensen');
	});

	it('keeps platforms apart so a Google Chat email cannot resolve in WhatsApp', () => {
		db.prepare(
			`INSERT INTO player_identities (player_id,league_id,identity_type,identifier)
			 VALUES (1,2,'google-chat','mattmariani@gmail.com')`,
		).run();
		expect(buildChatRoster(db, 2, [], 'whatsapp').resolve('mattmariani@gmail.com')).toBeNull();
		expect(buildChatRoster(db, 2, [], 'google-chat').resolve('mattmariani@gmail.com')?.name).toBe(
			'Matt Mariani',
		);
	});
});

describe('group pseudo-sender', () => {
	it('does not count the group itself as a participant', () => {
		const db = new Database(':memory:');
		db.exec(`CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
			CREATE TABLE player_identities (id INTEGER PRIMARY KEY, player_id INTEGER,
				league_id INTEGER, identity_type TEXT, identifier TEXT);`);
		const r = buildChatRoster(db, 3, ['Second Best chat', 'Real Person'], 'whatsapp', 'Second Best chat');
		expect(r.resolve('Second Best chat')).toBeNull();
		expect(r.unmapped).toEqual(['Real Person']);
	});
});

describe('unique-prefix matching', () => {
	let db: Database.Database;
	beforeEach(() => {
		db = new Database(':memory:');
		db.exec(`
			CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
			CREATE TABLE player_identities (id INTEGER PRIMARY KEY, player_id INTEGER,
				league_id INTEGER, identity_type TEXT, identifier TEXT);
			INSERT INTO players (id,name) VALUES (6,'TJ Cook'),(9,'Sara Black'),(10,'Sarah Zucker');
			INSERT INTO player_identities (player_id,league_id,identity_type,identifier) VALUES
				(6,3,'whatsapp','Tj Cook'),
				(9,3,'whatsapp','Sarah Black'),
				(10,3,'whatsapp','Sarah Zucker');
		`);
	});

	it('merges a short profile name onto the one person it can be', () => {
		// The relay shows "~ Tj"; the contact book stored "Tj Cook".
		const r = buildChatRoster(db, 3, ['~ Tj']);
		expect(r.resolve('~ Tj')?.name).toBe('TJ Cook');
		expect(r.resolve('~ Tj')?.unmapped).toBe(false);
		expect(r.unmapped).toEqual([]);
	});

	it('refuses to guess when two people share the prefix', () => {
		// "~ Sarah" fits Sarah Black AND Sarah Zucker — naming one would be a coin
		// flip, in a section that prints people's names publicly.
		const r = buildChatRoster(db, 3, ['~ Sarah']);
		expect(r.resolve('~ Sarah')?.unmapped).toBe(true);
		expect(r.unmapped).toEqual(['~ Sarah']);
	});

	it('does not match on a partial word', () => {
		// "~ T" must not silently become TJ Cook.
		const r = buildChatRoster(db, 3, ['~ T']);
		expect(r.resolve('~ T')?.unmapped).toBe(true);
	});
});

describe('corrupted sender strings', () => {
	it('survives a lost byte rather than minting a new participant', () => {
		const db = new Database(':memory:');
		db.exec(`CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
			CREATE TABLE player_identities (id INTEGER PRIMARY KEY, player_id INTEGER,
				league_id INTEGER, identity_type TEXT, identifier TEXT);
			INSERT INTO players (id,name) VALUES (4,'Jon Black');
			INSERT INTO player_identities (player_id,league_id,identity_type,identifier)
				VALUES (4,3,'whatsapp','~ JB');`);
		const r = buildChatRoster(db, 3, ['~�JB']);
		expect(r.resolve('~�JB')?.name).toBe('Jon Black');
		expect(r.unmapped).toEqual([]);
	});
});
