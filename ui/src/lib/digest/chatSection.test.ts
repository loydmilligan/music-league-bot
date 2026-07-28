import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
	chatWindowFor,
	loadChatWindow,
	rotationFor,
	buildChatSection,
	CHARTS,
	FEATURES,
	AWARD_POOL,
	EXPORT_ONLY_AWARDS,
	recommendParts,
	tzOffsetMinutes,
	loadWordLists,
	chatSectionEnabledFor,
	setChatSectionEnabled,
} from './chatSection';

describe('chatWindowFor', () => {
	it('runs from the previous round end to this round end', () => {
		const w = chatWindowFor('2026-07-24T08:30:00Z', '2026-07-17T08:00:00Z')!;
		expect(w.fromIso).toBe('2026-07-17T08:00:00.000Z');
		expect(w.toIso).toBe('2026-07-24T08:30:00.000Z');
		expect(w.days).toBe(7);
	});

	it('falls back to seven days for the first round of a season', () => {
		const w = chatWindowFor('2026-07-24T08:30:00Z', null)!;
		expect(w.fromIso).toBe('2026-07-17T08:30:00.000Z');
		expect(w.days).toBe(7);
	});

	it('ignores a previous end that is not actually earlier', () => {
		// Bad data must not produce an inverted window that selects nothing.
		const w = chatWindowFor('2026-07-24T08:30:00Z', '2026-07-30T00:00:00Z')!;
		expect(Date.parse(w.fromIso)).toBeLessThan(Date.parse(w.toIso));
	});

	it('returns null without a round end', () => {
		expect(chatWindowFor(null, null)).toBeNull();
		expect(chatWindowFor('not-a-date', null)).toBeNull();
	});
});

describe('rotationFor', () => {
	it('alternates the chart every round', () => {
		expect(rotationFor(0).chart).toBe(CHARTS[0]);
		expect(rotationFor(1).chart).toBe(CHARTS[1]);
		expect(rotationFor(2).chart).toBe(CHARTS[0]);
	});

	it('walks the feature pool', () => {
		const seen = [0, 1, 2, 3].map((n) => rotationFor(n).feature);
		expect(new Set(seen).size).toBe(FEATURES.length);
	});

	it('gives different awards to consecutive rounds', () => {
		const a = rotationFor(1).awards;
		const b = rotationFor(2).awards;
		expect(a).not.toEqual(b);
		expect(new Set(a).size).toBe(a.length); // no repeats within a week
	});

	it('is deterministic, so regenerating a digest does not reshuffle it', () => {
		expect(rotationFor(5)).toEqual(rotationFor(5));
	});

	it('never offers an export-only award', () => {
		for (const k of AWARD_POOL) expect(EXPORT_ONLY_AWARDS.has(k)).toBe(false);
	});
});

describe('loadChatWindow', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		db.exec(`CREATE TABLE chat_messages (
			id TEXT, platform TEXT, group_name TEXT, group_key TEXT,
			sender TEXT, text TEXT, ts TEXT, msg_hash TEXT, captured_at TEXT
		);
		CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
		CREATE TABLE player_identities (
			id INTEGER PRIMARY KEY, player_id INTEGER, league_id INTEGER,
			identity_type TEXT, identifier TEXT
		);
		INSERT INTO players (id,name) VALUES (1,'Matt Mariani'),(2,'Grant Koziol'),(3,'Jimmy');
		INSERT INTO player_identities (player_id,league_id,identity_type,identifier) VALUES
			(1,5,'whatsapp','Matt Mariani'),
			(2,5,'whatsapp','~ Grant'),
			(3,5,'whatsapp','~ Jimmy');`);
		const ins = db.prepare(
			`INSERT INTO chat_messages (group_name, sender, text, ts) VALUES (?,?,?,?)`,
		);
		ins.run('G', 'Matt Mariani', 'hello there friend', '2026-07-18T10:00:00Z');
		// Narrow-no-break-space tilde, as the relay actually writes it.
		ins.run('G', '~ Grant', 'a real message here', '2026-07-19T10:00:00Z');
		ins.run('G', '+1 (775) 338-1153', 'Waiting for this message. This may take a while.', '2026-07-19T11:00:00Z');
		ins.run('G', 'Nobody Known', 'who is this', '2026-07-19T12:00:00Z');
		ins.run('G', 'Matt Mariani', 'IMG-1.jpg (file attached)', '2026-07-20T10:00:00Z');
		ins.run('G', 'Matt Mariani', 'outside the window', '2026-08-01T10:00:00Z');
		ins.run('OTHER', 'Matt Mariani', 'different group', '2026-07-19T10:00:00Z');
	});

	const win = { fromIso: '2026-07-17T00:00:00Z', toIso: '2026-07-25T00:00:00Z', days: 8 };

	it('reads only the named group inside the window', () => {
		const { messages } = loadChatWindow(db, 'G', win);
		expect(messages.every((m) => m.text !== 'different group')).toBe(true);
		expect(messages.every((m) => m.text !== 'outside the window')).toBe(true);
	});

	it('drops relay placeholders instead of counting them as chat', () => {
		const { messages, skippedPlaceholders } = loadChatWindow(db, 'G', win);
		expect(skippedPlaceholders).toBe(1);
		expect(messages.some((m) => /Waiting for this message/.test(m.text))).toBe(false);
	});

	it('reports every sender it saw, for the roster to resolve', () => {
		const { sendersSeen } = loadChatWindow(db, 'G', win);
		expect(sendersSeen).toContain('Nobody Known');
		expect(sendersSeen).toContain('Matt Mariani');
	});

	it('flags attachments as media', () => {
		const { messages } = loadChatWindow(db, 'G', win);
		expect(messages.find((m) => m.text.includes('IMG-1.jpg'))?.media).toBeTruthy();
	});

	it('never marks a relay message as edited — the relay cannot know', () => {
		const { messages } = loadChatWindow(db, 'G', win);
		expect(messages.every((m) => m.edited === false)).toBe(true);
	});
});

describe('buildChatSection', () => {
	let db: Database.Database;

	beforeEach(() => {
		db = new Database(':memory:');
		db.exec(`CREATE TABLE chat_messages (
			id TEXT, platform TEXT, group_name TEXT, group_key TEXT,
			sender TEXT, text TEXT, ts TEXT, msg_hash TEXT, captured_at TEXT
		);
		CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
		CREATE TABLE player_identities (
			id INTEGER PRIMARY KEY, player_id INTEGER, league_id INTEGER,
			identity_type TEXT, identifier TEXT
		);
		INSERT INTO players (id,name) VALUES (1,'Matt Mariani'),(2,'Grant Koziol'),(3,'Jimmy');
		INSERT INTO player_identities (player_id,league_id,identity_type,identifier) VALUES
			(1,5,'whatsapp','Matt Mariani'),
			(2,5,'whatsapp','~ Grant'),
			(3,5,'whatsapp','~ Jimmy');`);
		const ins = db.prepare(
			`INSERT INTO chat_messages (group_name, sender, text, ts) VALUES (?,?,?,?)`,
		);
		for (let i = 0; i < 60; i++) {
			ins.run('G', 'Matt Mariani', `message number ${i} with several words in it`, `2026-07-2${i % 3}T1${i % 10}:00:00Z`);
		}
		for (let i = 0; i < 40; i++) {
			ins.run('G', '~ Grant', `another message ${i} carrying words along`, `2026-07-2${i % 3}T1${i % 10}:30:00Z`);
		}
		// One message only: must not be rankable on language awards.
		ins.run('G', '~ Jimmy', 'hi', '2026-07-22T09:00:00Z');
	});

	const opts = {
		groupName: 'G',
		leagueId: 5,
		roundNumber: 1,
		roundEndIso: '2026-07-24T00:00:00Z',
		previousRoundEndIso: '2026-07-17T00:00:00Z',
	};

	it('assembles a section with a window, stats and a rotation', () => {
		const s = buildChatSection(db, opts)!;
		expect(s.window.days).toBe(7);
		expect(s.messageCount).toBe(101);
		expect(s.participantCount).toBe(3);
		expect(s.rotation.chart).toBe(CHARTS[1]); // round 1
		expect(s.awards.length).toBeGreaterThan(0);
	});

	it('holds back people who barely spoke from the language awards', () => {
		const s = buildChatSection(db, opts)!;
		const jimmy = s.stats.people.find((p) => p.name === 'Jimmy')!;
		expect(jimmy.eligible).toBe(false);
		// He can still be the Lurker — being quiet is the award.
		expect(s.stats.awards.lurker?.person).toBe('Jimmy');
		// But never a language winner.
		for (const k of ['linguist', 'professor', 'vocabulary', 'variety', 'wordsmith']) {
			expect(s.stats.awards[k]?.person).not.toBe('Jimmy');
		}
	});

	it('flags a quiet window instead of publishing noise', () => {
		const quiet = new Database(':memory:');
		quiet.exec(`CREATE TABLE chat_messages (
			id TEXT, platform TEXT, group_name TEXT, group_key TEXT,
			sender TEXT, text TEXT, ts TEXT, msg_hash TEXT, captured_at TEXT
		);
		CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
		CREATE TABLE player_identities (
			id INTEGER PRIMARY KEY, player_id INTEGER, league_id INTEGER,
			identity_type TEXT, identifier TEXT
		);`);
		quiet
			.prepare(`INSERT INTO chat_messages (group_name, sender, text, ts) VALUES (?,?,?,?)`)
			.run('G', 'Matt Mariani', 'just the one', '2026-07-20T10:00:00Z');
		expect(buildChatSection(quiet, opts)!.tooQuiet).toBe(true);
	});

	it('returns null when the round has no end date to anchor the window', () => {
		expect(buildChatSection(db, { ...opts, roundEndIso: null })).toBeNull();
	});

	it('never surfaces an export-only award in the weekly strip', () => {
		const s = buildChatSection(db, { ...opts, awardCount: AWARD_POOL.length })!;
		for (const a of s.awards) expect(EXPORT_ONLY_AWARDS.has(a.key)).toBe(false);
	});
});

describe('recommendParts', () => {
	const base = (awards: { key: string; person: string }[], messageCount = 500) =>
		({
			window: { fromIso: '', toIso: '', days: 7 },
			groupName: 'G',
			messageCount,
			participantCount: 5,
			stats: {} as never,
			rotation: { chart: 'heatmap', feature: 'biggestWord', awards: awards.map((a) => a.key) },
			awards: awards.map((a) => ({ ...a, value: '', caption: '' })),
			unmappedSenders: [],
			tooQuiet: messageCount < 40,
		}) as never;

	it('flags an award whose winner has not changed', () => {
		const now = base([{ key: 'motormouth', person: 'Grant' }, { key: 'linguist', person: 'Jon' }]);
		const before = base([{ key: 'motormouth', person: 'Grant' }, { key: 'linguist', person: 'Matt' }]);
		const r = recommendParts(now, before).find((x) => x.part === 'superlatives')!;
		expect(r.reason).toMatch(/Grant wins motormouth again/);
		expect(r.reason).not.toMatch(/Jon/);
	});

	it('is happy when every winner changed', () => {
		const now = base([{ key: 'motormouth', person: 'Grant' }]);
		const before = base([{ key: 'motormouth', person: 'Matt' }]);
		const r = recommendParts(now, before).find((x) => x.part === 'superlatives')!;
		expect(r.include).toBe(true);
		expect(r.reason).toMatch(/All winners changed/);
	});

	it('recommends dropping everything when the group barely spoke', () => {
		const r = recommendParts(base([{ key: 'motormouth', person: 'Grant' }], 12));
		expect(r.every((x) => !x.include)).toBe(true);
		expect(r[0].reason).toMatch(/Only 12 messages/);
	});

	it('turns liner notes off when the LLM produced none', () => {
		const r = recommendParts(base([]), null, false).find((x) => x.part === 'linerNotes')!;
		expect(r.include).toBe(false);
	});
});

describe('timezone handling', () => {
	it('tracks daylight saving rather than assuming a fixed offset', () => {
		expect(tzOffsetMinutes(new Date('2026-07-20T12:00:00Z'), 'America/Los_Angeles')).toBe(-420);
		expect(tzOffsetMinutes(new Date('2026-01-20T12:00:00Z'), 'America/Los_Angeles')).toBe(-480);
	});

	it('converts stored UTC into local wall-clock hours', () => {
		const db = new Database(':memory:');
		db.exec(`CREATE TABLE chat_messages (
			id TEXT, platform TEXT, group_name TEXT, group_key TEXT,
			sender TEXT, text TEXT, ts TEXT, msg_hash TEXT, captured_at TEXT
		);
		CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT);
		CREATE TABLE player_identities (
			id INTEGER PRIMARY KEY, player_id INTEGER, league_id INTEGER,
			identity_type TEXT, identifier TEXT
		);
		INSERT INTO players (id,name) VALUES (1,'Matt Mariani'),(2,'Grant Koziol'),(3,'Jimmy');
		INSERT INTO player_identities (player_id,league_id,identity_type,identifier) VALUES
			(1,5,'whatsapp','Matt Mariani'),
			(2,5,'whatsapp','~ Grant'),
			(3,5,'whatsapp','~ Jimmy');`);
		// 01:00 UTC in July is 18:00 the previous day in Los Angeles. Reading UTC
		// hours straight would call this "after midnight" and hand out Night Owl.
		db.prepare(`INSERT INTO chat_messages (group_name, sender, text, ts) VALUES (?,?,?,?)`)
			.run('G', 'Matt Mariani', 'evening message', '2026-07-21T01:00:00Z');
		const { messages } = loadChatWindow(
			db,
			'G',
			{ fromIso: '2026-07-01T00:00:00Z', toIso: '2026-08-01T00:00:00Z', days: 31 },
			'America/Los_Angeles',
		);
		expect(new Date(messages[0].ts).getUTCHours()).toBe(18);
		expect(new Date(messages[0].ts).getUTCDate()).toBe(20);
	});
});

describe('word lists', () => {
	it('bundles a dictionary and frequency list so the container has them', () => {
		const { dictionary, commonWords } = loadWordLists();
		expect(dictionary.size).toBeGreaterThan(40_000);
		expect(commonWords.length).toBeGreaterThan(9_000);
		expect(commonWords[0]).toBe('the');
		// Proper nouns must be absent, or they win the language awards.
		expect(dictionary.has('columbus')).toBe(false);
		expect(dictionary.has('sacrilegious')).toBe(true);
	});
});

describe('award rotation period', () => {
	it('does not repeat the whole strip after only a few rounds', () => {
		const first = rotationFor(0).awards.join('|');
		const repeats = [1, 2, 3, 4, 5].filter((n) => rotationFor(n).awards.join('|') === first);
		expect(repeats).toEqual([]);
	});

	it('eventually cycles, and covers the pool along the way', () => {
		const seen = new Set<string>();
		for (let n = 0; n < AWARD_POOL.length; n++) rotationFor(n).awards.forEach((a) => seen.add(a));
		expect(seen.size).toBe(AWARD_POOL.length);
	});
});

describe('per-league opt-in', () => {
	let db: Database.Database;
	beforeEach(() => {
		db = new Database(':memory:');
		db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
	});

	it('defaults to Boarz on, the rest off', () => {
		expect(chatSectionEnabledFor(db, 'boarz-ii-men')).toBe(true);
		expect(chatSectionEnabledFor(db, 'second-best')).toBe(false);
		expect(chatSectionEnabledFor(db, 'fam-jam')).toBe(false);
	});

	it('defaults an unknown league to off rather than on', () => {
		expect(chatSectionEnabledFor(db, 'brand-new-league')).toBe(false);
	});

	it('remembers an explicit choice in both directions', () => {
		setChatSectionEnabled(db, 'second-best', true);
		setChatSectionEnabled(db, 'boarz-ii-men', false);
		expect(chatSectionEnabledFor(db, 'second-best')).toBe(true);
		expect(chatSectionEnabledFor(db, 'boarz-ii-men')).toBe(false);
	});

	it('falls back to defaults when the setting is corrupt', () => {
		db.prepare(`INSERT INTO settings (key,value) VALUES ('chat_section_leagues','{not json')`).run();
		expect(chatSectionEnabledFor(db, 'boarz-ii-men')).toBe(true);
	});
});
