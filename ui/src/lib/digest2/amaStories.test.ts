import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { attachAmaStories, AMA_STORY_SOURCES } from './amaStories.js';

let db: Database.Database;
const add = (id: string, sender: string, ts: string, text: string, captured: string) =>
	db
		.prepare('INSERT INTO chat_messages (id, group_name, sender, text, ts, captured_at) VALUES (?,?,?,?,?,?)')
		.run(id, 'Boarz', sender, text, ts, captured);

beforeEach(() => {
	db = new Database(':memory:');
	db.exec(`CREATE TABLE chat_messages (id TEXT PRIMARY KEY, group_name TEXT, sender TEXT, text TEXT, ts TEXT, captured_at TEXT)`);
	AMA_STORY_SOURCES[900] = [[{ who: 'Ann', ids: ['m1', 'm2'] }, { who: 'Bob', ids: ['m3'] }, null]];
});

const block = (answers: { who: string; summary: string }[]) => ({ title: 'AMA', amas: [{ prompt: 'Q?', answers }] });
const stories = (out: unknown) => (out as { amas: { answers: { story?: string[] }[] }[] }).amas[0].answers.map((a) => a.story);

describe('attachAmaStories', () => {
	it('joins the mapped messages in order, taking the newest capture of an edited message', () => {
		add('m1', 'Ann', 't1', 'first draft of the long story', '2026-10-15T23:27:16Z');
		add('m1b', 'Ann', 't1', 'final edit of the long story', '2026-10-15T23:29:14Z');
		add('m2', 'Ann', 't2', 'and then the second part', '2026-10-15T23:30:00Z');
		const out = attachAmaStories(db, 900, block([{ who: 'Ann', summary: 'short' }]));
		expect(stories(out)).toEqual([['final edit of the long story', 'and then the second part']]);
	});

	it('no story when the summary already is the whole message, or the answer is unmapped', () => {
		add('m3', 'Bob', 't3', "I don't really do cool", 'c');
		const out = attachAmaStories(db, 900, block([
			{ who: 'Ann', summary: 'x' },
			{ who: 'Bob', summary: '"I don\'t really do cool"' },
			{ who: 'Cat', summary: 'declined' },
		]));
		expect(stories(out)).toEqual([undefined, undefined, undefined]);
	});

	it('a who mismatch (reordered block) shows no story rather than the wrong one', () => {
		add('m1', 'Ann', 't1', 'a story that is definitely longer', 'c');
		const out = attachAmaStories(db, 900, block([{ who: 'Bob', summary: 's' }]));
		expect(stories(out)).toEqual([undefined]);
	});

	it('leaves the block untouched when chat_messages is missing', () => {
		const bare = new Database(':memory:');
		const content = block([{ who: 'Ann', summary: 's' }]);
		expect(attachAmaStories(bare, 900, content)).toBe(content);
	});

	it('R168 map lines up with the live block shape (7 + 5 answers)', () => {
		expect(AMA_STORY_SOURCES[168].map((p) => p.length)).toEqual([7, 5]);
	});
});
