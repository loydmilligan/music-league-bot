import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { openLeagueDb } from '$lib/db/client.js';
import { insertModel } from '$lib/db/aiModels.js';

vi.mock('./inputs.js', async (orig) => {
	const actual = await orig<typeof import('./inputs.js')>();
	return {
		...actual,
		listPlayers: vi.fn((league: string) =>
			league === 'boarz-ii-men'
				? [
					{ slug: 'shane', name: 'Shane Smith', leagueSlug: league, headshotRel: 'x', lowRes: false, missing: false },
					{ slug: 'berto', name: 'Berto Ruiz', leagueSlug: league, headshotRel: 'x', lowRes: false, missing: false },
				]
				: [],
		),
	};
});

import { createProject, updateProject } from './repo.js';
import { COVER_JOB_KEYS } from './models.js';
import { coverFile } from './paths.js';
import { applyConcept, pitchConcepts, PITCH_PROMPT, type Concept } from './pitch.js';
import type { Breakdown } from './breakdown.js';
import type { FetchLike } from '../avatarFactory/openrouter.js';

const db = openLeagueDb(':memory:');
let pid = 0;
let prevData: string | undefined, prevProf: string | undefined;

const BREAKDOWN: Breakdown = {
	style: 'glossy 3D render', composition: 'centered cube', palette_lighting: 'pink', text_elements: [],
	subjects: [{ label: 'A', kind: 'object', role: 'main', position: 'center', pose: '', gaze: '', clothing: '', expression: '', color_treatment: '', focus: 'sharp', box: [0.2, 0.2, 0.6, 0.6] }],
	no_subjects: true,
};

beforeAll(async () => {
	prevData = process.env.DATA_DIR; prevProf = process.env.COVER_PROFILES_DIR;
	process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'cf-pitch-data-'));
	const prof = mkdtempSync(join(tmpdir(), 'cf-pitch-prof-'));
	writeFileSync(join(prof, 'Shane_Smith.md'), '# Shane\n\n## 3. Humor style\n\nShane cannot stop talking about his sourdough starter.\n');
	process.env.COVER_PROFILES_DIR = prof;
	const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#c9a' } }).png().toBuffer();
	mkdirSync(dirname(coverFile('covers/p.png')), { recursive: true });
	writeFileSync(coverFile('covers/p.png'), png);
});
afterAll(() => {
	if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData;
	if (prevProf === undefined) delete process.env.COVER_PROFILES_DIR; else process.env.COVER_PROFILES_DIR = prevProf;
});
beforeEach(() => {
	delete process.env.AVATAR_FACTORY_GEN_PAUSED;
	db.exec('DELETE FROM cover_requests; DELETE FROM cover_versions; DELETE FROM cover_projects; DELETE FROM ai_models;');
	db.prepare("DELETE FROM settings WHERE key LIKE 'cover_factory_%'").run();
	insertModel(db, {
		model_id: 'txt/pitcher', nickname: null, description: null, model_type: null, context_len: null,
		price_in: null, price_out: null, is_free: 0, cost_override: null, cap_reason: 0, cap_stream: 1,
		cap_vision: 1, cap_tools: 0, cap_json: 1, favorite: 0, sort_order: 0, kinds: '["text","vision"]',
	});
	db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(COVER_JOB_KEYS.pitch, 'txt/pitcher');
	pid = createProject(db, { title: 'Flesh Cube', source: 'upload', round_id: null, spotify_uri: null, league_slug: 'boarz-ii-men', cover_rel: 'covers/p.png', cover_url: null }).id;
	updateProject(db, pid, { breakdown_json: JSON.stringify(BREAKDOWN) });
});

const rows = () => db.prepare('SELECT * FROM cover_requests').all() as Record<string, unknown>[];
function fakeFetch(content: unknown) {
	const calls: Record<string, any>[] = [];
	const f = vi.fn<FetchLike>(async (_u, init) => {
		calls.push(JSON.parse(String(init?.body ?? '{}')));
		return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost: 0.004 } }), { status: 200 });
	});
	return { f, calls };
}

const GOOD = {
	concepts: [
		{ move: 'morph', title: 'Cube Shane', plan: "Shane's face as the mound on the flesh cube",
			treatments: [{ label: 'A', mode: 'player', playerSlug: 'shane', notes: 'the mound becomes his face' }], addSubjects: [] },
		{ move: 'signature', title: 'Starter', plan: 'A jar of Shane’s sourdough starter oozing over the cube',
			treatments: [{ label: 'N1', mode: 'player', playerSlug: 'shane', notes: 'the jar label reads SHANE' }],
			addSubjects: [{ label: 'N1', kind: 'object', role: 'secondary', position: 'bottom left', box: [0.05, 0.7, 0.2, 0.25] }] },
		{ move: 'recast', title: 'Cube Keeper', plan: 'Berto as the cube’s proud owner, cradling it',
			treatments: [{ label: 'N1', mode: 'player', playerSlug: 'berto' }],
			addSubjects: [{ label: 'N1', kind: 'person', role: 'main', position: 'behind the cube' }] },
	],
};

describe('PITCH_PROMPT', () => {
	it('states the taste bar, the anchors, morph fallback, and forbids alternate covers', () => {
		expect(PITCH_PROMPT).toMatch(/funny for that player/i);
		expect(PITCH_PROMPT).toMatch(/mashup/i);
		expect(PITCH_PROMPT).toContain("Shane's face as the mound on the flesh cube");
		expect(PITCH_PROMPT).toContain("Matt as the leashed tiger on all fours, leash from the woman's hand to his neck");
		expect(PITCH_PROMPT).toContain("Berto's butt in jean shorts");
		expect(PITCH_PROMPT).toMatch(/"morph".*fallback/s);
		expect(PITCH_PROMPT).toMatch(/never suggest .*alternate/i);
	});
});

describe('pitchConcepts', () => {
	it('returns concepts across the three moves and logs a pitch request', async () => {
		const { f, calls } = fakeFetch(GOOD);
		const cs = await pitchConcepts(db, pid, { playerSlugs: ['shane', 'berto'], count: 3, fetchImpl: f });
		expect(cs.map((c) => c.move)).toEqual(['morph', 'signature', 'recast']);
		expect(new Set(cs.map((c) => c.id)).size).toBe(3);
		expect(cs[1].addSubjects[0]).toMatchObject({ label: 'N1', kind: 'object', box: [0.05, 0.7, 0.2, 0.25] });
		expect(cs[0].treatments[0]).toMatchObject({ label: 'A', mode: 'player', playerSlug: 'shane', playerName: 'Shane Smith' });
		const r = rows();
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ step: 'pitch', outcome: 'ok', cost_usd: 0.004, model_id: 'txt/pitcher' });
		// prompt carries players, profile excerpt, breakdown and the cover image
		const content = calls[0].messages[0].content;
		const text = content[0].text as string;
		expect(text).toContain('Shane Smith (slug: shane)');
		expect(text).toContain('sourdough starter');
		expect(text).toContain('glossy 3D render');
		expect(text).toMatch(/exactly 3 concepts/);
		expect(content[1].image_url.url).toMatch(/^data:image\//);
	});

	it('drops unknown moves, strangers and unknown labels', async () => {
		const { f } = fakeFetch({
			concepts: [
				{ move: 'alternate', title: 'Alt', plan: 'Use the deluxe edition cover', treatments: [], addSubjects: [] },
				{ move: 'morph', title: 'M', plan: 'Shane as the cube',
					treatments: [
						{ label: 'A', mode: 'player', playerSlug: 'shane' },
						{ label: 'A', mode: 'player', playerSlug: 'stranger' },
						{ label: 'Q', mode: 'player', playerSlug: 'shane' },
					], addSubjects: [] },
			],
		});
		const cs = await pitchConcepts(db, pid, { playerSlugs: ['shane'], fetchImpl: f });
		expect(cs).toHaveLength(1);
		expect(cs[0].move).toBe('morph');
		expect(cs[0].treatments).toEqual([{ label: 'A', mode: 'player', playerSlug: 'shane', playerName: 'Shane Smith' }]);
	});

	it('while paused throws and makes no provider call', async () => {
		process.env.AVATAR_FACTORY_GEN_PAUSED = '1';
		const { f } = fakeFetch(GOOD);
		await expect(pitchConcepts(db, pid, { playerSlugs: ['shane'], fetchImpl: f })).rejects.toThrow(/paused/i);
		expect(f).not.toHaveBeenCalled();
		expect(rows()).toHaveLength(0);
	});

	it('errors clearly with no pitch model', async () => {
		db.exec('DELETE FROM ai_models');
		const { f } = fakeFetch(GOOD);
		await expect(pitchConcepts(db, pid, { playerSlugs: ['shane'], fetchImpl: f })).rejects.toThrow(/no pitch model/i);
		expect(f).not.toHaveBeenCalled();
	});

	it('logs an error row on an unparseable reply', async () => {
		const f = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'sorry' } }], usage: { cost: 0.001 } }), { status: 200 });
		await expect(pitchConcepts(db, pid, { playerSlugs: ['shane'], fetchImpl: f })).rejects.toThrow('unparseable');
		expect(rows()[0]).toMatchObject({ step: 'pitch', outcome: 'error', error_reason: 'unparseable', cost_usd: 0.001 });
	});
});

describe('applyConcept', () => {
	const empty: Breakdown = { ...BREAKDOWN, subjects: [], no_subjects: true };
	const concept: Concept = {
		id: 'c1', move: 'recast', title: 'T', plan: 'p',
		addSubjects: [{ label: 'N1', kind: 'person', role: 'main', position: 'center', pose: '', gaze: '', clothing: '', expression: '', color_treatment: '', focus: '' }],
		treatments: [{ label: 'N1', mode: 'player', playerSlug: 'shane', playerName: 'Shane Smith' }],
	};
	it('labels added subjects with the next free letter and remaps treatments', () => {
		const r = applyConcept(empty, [], concept);
		expect(r.breakdown.subjects.map((s) => s.label)).toEqual(['A']);
		expect(r.breakdown.subjects[0].conceptId).toBe('c1');
		expect(r.breakdown.no_subjects).toBe(false);
		expect(r.treatments).toEqual([{ label: 'A', mode: 'player', playerSlug: 'shane', playerName: 'Shane Smith' }]);
	});
	it('is idempotent for the same concept id', () => {
		const once = applyConcept(empty, [], concept);
		const twice = applyConcept(once.breakdown, once.treatments, concept);
		expect(twice.breakdown.subjects).toHaveLength(1);
		expect(twice.treatments).toEqual(once.treatments);
	});
	it('skips taken letters and merges over current treatments by label', () => {
		const r = applyConcept(BREAKDOWN, [{ label: 'A', mode: 'keep' }], {
			...concept, treatments: [...concept.treatments, { label: 'A', mode: 'remove' }],
		});
		expect(r.breakdown.subjects.map((s) => s.label)).toEqual(['A', 'B']);
		expect(r.treatments).toEqual([
			{ label: 'A', mode: 'remove' },
			{ label: 'B', mode: 'player', playerSlug: 'shane', playerName: 'Shane Smith' },
		]);
	});
});

describe('cover_requests migration', () => {
	it("rebuilds an old-CHECK table to accept 'pitch', keeping prior rows", () => {
		const path = join(mkdtempSync(join(tmpdir(), 'cf-mig-')), 'league.db');
		const d1 = openLeagueDb(path);
		const p = createProject(d1, { title: 'Old', source: 'upload', round_id: null, spotify_uri: null, league_slug: null, cover_rel: 'a.png', cover_url: null }).id;
		d1.exec(`DROP TABLE cover_requests;
			CREATE TABLE cover_requests (
			  id INTEGER PRIMARY KEY AUTOINCREMENT,
			  project_id INTEGER NOT NULL REFERENCES cover_projects(id) ON DELETE CASCADE,
			  version_id INTEGER,
			  step TEXT NOT NULL CHECK(step IN ('read','identity','generate')),
			  model_id TEXT NOT NULL, provider TEXT NOT NULL, latency_ms INTEGER NOT NULL, cost_usd REAL,
			  cost_estimated INTEGER NOT NULL DEFAULT 0,
			  outcome TEXT NOT NULL CHECK(outcome IN ('ok','no_image','error')),
			  error_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
			CREATE INDEX idx_cover_requests_project ON cover_requests(project_id);`);
		d1.prepare("INSERT INTO cover_requests (project_id, version_id, step, model_id, provider, latency_ms, cost_usd, cost_estimated, outcome, error_reason) VALUES (?, NULL, 'read', 'm', 'openrouter', 5, 0.01, 0, 'ok', NULL)").run(p);
		expect(() => d1.prepare("INSERT INTO cover_requests (project_id, step, model_id, provider, latency_ms, outcome) VALUES (?, 'pitch', 'm', 'o', 1, 'ok')").run(p)).toThrow(/CHECK/);
		d1.close();

		const d2 = openLeagueDb(path);
		d2.prepare("INSERT INTO cover_requests (project_id, step, model_id, provider, latency_ms, outcome) VALUES (?, 'pitch', 'm', 'o', 1, 'ok')").run(p);
		const all = d2.prepare('SELECT step, cost_usd FROM cover_requests ORDER BY id').all();
		expect(all).toEqual([{ step: 'read', cost_usd: 0.01 }, { step: 'pitch', cost_usd: null }]);
		const idx = d2.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_cover_requests_project'").get();
		expect(idx).toBeTruthy();
		d2.close();
		// a reopened, already-migrated DB is left alone
		const d3 = new Database(path);
		expect((d3.prepare("SELECT sql FROM sqlite_master WHERE name='cover_requests'").get() as { sql: string }).sql).toContain("'pitch'");
		d3.close();
	});
});
