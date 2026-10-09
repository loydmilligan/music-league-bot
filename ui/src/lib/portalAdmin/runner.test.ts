import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { defaultConfig, type SectionId } from './config.js';
import { readConfig, writeConfig } from './store.js';

let db: Database.Database;
let digests: string;
let enqueueSectionRun: (typeof import('./runner.js'))['enqueueSectionRun'];
let getRunStatus: (typeof import('./runner.js'))['getRunStatus'];

function seedBase(lea: Database.Database) {
	lea.prepare(`INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz')`).run();
	lea.prepare(
		`INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 2, 'active')`
	).run();
	lea.prepare(
		`INSERT INTO dashboard_sites (slug, league_id, season, read_model, published_at, refreshed_at)
		 VALUES ('bz', 1, 2, '{}', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`
	).run();
	writeConfig(lea, 1, defaultConfig());
}

beforeAll(async () => {
	digests = mkdtempSync(join(tmpdir(), 'portal-admin-runner-'));
	process.env.DIGESTS_DIR = digests;
	({ enqueueSectionRun, getRunStatus } = await import('./runner.js'));
});

beforeEach(() => {
	db = openLeagueDb(':memory:');
	seedBase(db);
	rmSync(join(digests, 'bz'), { recursive: true, force: true });
});

afterAll(() => {
	rmSync(digests, { recursive: true, force: true });
	delete process.env.DIGESTS_DIR;
});

const portalJsonPath = () => join(digests, 'bz', 'portal.json');

describe('runSection / enqueueSectionRun — real builder', () => {
	it('regenerates portal.json for an enabled section and records ok', async () => {
		const { jobId } = await enqueueSectionRun(db, 1, 'pulse');
		const row = db.prepare('SELECT status, error FROM portal_admin_runs WHERE id = ?').get(jobId) as {
			status: string;
			error: string | null;
		};
		expect(row.status).toBe('done');
		expect(row.error).toBeNull();

		const runState = readConfig(db, 1).runState.pulse;
		expect(runState.lastStatus).toBe('ok');
		expect(runState.lastError).toBeNull();
		expect(typeof runState.lastRunAt).toBe('string');

		expect(existsSync(portalJsonPath())).toBe(true);
		const portal = JSON.parse(readFileSync(portalJsonPath(), 'utf8'));
		expect(portal.version).toBe(1);
		expect(portal.sections.enabled.pulse).toBe(true);
		expect(getRunStatus(db, jobId)?.status).toBe('done');
	});

	it('fails a run for a disabled section and records the error', async () => {
		const cfg = defaultConfig();
		cfg.sections.pulse.enabled = false;
		writeConfig(db, 1, cfg);
		const { jobId } = await enqueueSectionRun(db, 1, 'pulse');
		const row = db.prepare('SELECT status, error FROM portal_admin_runs WHERE id = ?').get(jobId) as {
			status: string;
			error: string | null;
		};
		expect(row.status).toBe('failed');
		expect(row.error).toContain('disabled');

		const runState = readConfig(db, 1).runState.pulse;
		expect(runState.lastStatus).toBe('error');
		expect(runState.lastError).toContain('disabled');
	});

	it('fails for a league with no dashboard site row', async () => {
		db.prepare(`INSERT INTO leagues (id, slug, name) VALUES (2, 'fb', 'Fresh Board')`).run();
		const { jobId } = await enqueueSectionRun(db, 2, 'byNumbers');
		const row = db.prepare('SELECT status, error FROM portal_admin_runs WHERE id = ?').get(jobId) as {
			status: string;
			error: string | null;
		};
		expect(row.status).toBe('failed');
		expect(row.error).toContain('no dashboard site');
	});

	it('fails defensively for an unknown section id', async () => {
		const { jobId } = await enqueueSectionRun(db, 1, 'nope' as SectionId);
		const row = db.prepare('SELECT status FROM portal_admin_runs WHERE id = ?').get(jobId) as {
			status: string;
		};
		expect(row.status).toBe('failed');
	});
});