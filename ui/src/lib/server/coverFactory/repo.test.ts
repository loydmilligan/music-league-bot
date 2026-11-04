import { describe, it, expect, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';
import {
	createProject, getProject, listProjects, updateProject, insertVersion, listVersions,
	rateVersion, logRequest, projectStats
} from './repo.js';
import { coverFile, coverRoot } from './paths.js';

const db = openLeagueDb(':memory:');
beforeEach(() => db.exec('DELETE FROM cover_requests; DELETE FROM cover_versions; DELETE FROM cover_projects;'));

const proj = (title = 'T') =>
	createProject(db, { title, source: 'upload', round_id: null, spotify_uri: null, league_slug: null, cover_rel: 'a/b.png', cover_url: null });
const ver = (project_id: number, status: 'ok' | 'failed' = 'ok') =>
	insertVersion(db, { project_id, model_id: 'm', provider: 'p', prompt: 'x', image_rel: status === 'ok' ? 'i.png' : null, status, error_reason: null });
const req = (project_id: number, outcome: 'ok' | 'no_image', cost: number) =>
	logRequest(db, { project_id, version_id: null, step: 'generate', model_id: 'm', provider: 'p', latency_ms: 5, cost_usd: cost, cost_estimated: 0, outcome, error_reason: null });

describe('coverFactory repo', () => {
	it('creates and gets a project', () => {
		const p = proj('Hello');
		expect(getProject(db, p.id)).toMatchObject({ title: 'Hello', identities_json: null, keeper_version_id: null });
		expect(getProject(db, 999)).toBeNull();
	});
	it('updateProject patches incl. identities_json', () => {
		const p = proj();
		const u = updateProject(db, p.id, { identities_json: '{"a":"b"}', title: 'N' });
		expect(u.identities_json).toBe('{"a":"b"}');
		expect(u.title).toBe('N');
	});
	it('assigns try_no sequentially per project', () => {
		const a = proj(), b = proj();
		expect(ver(a.id).try_no).toBe(1);
		expect(ver(a.id).try_no).toBe(2);
		expect(ver(b.id).try_no).toBe(1);
		expect(listVersions(db, a.id).map((v) => v.try_no)).toEqual([1, 2]);
	});
	it('rateVersion validates and persists only given keys', () => {
		const v = ver(proj().id);
		expect(() => rateVersion(db, v.id, { likeness: 6 })).toThrow();
		expect(() => rateVersion(db, v.id, { gag: 0 })).toThrow();
		const r = rateVersion(db, v.id, { gag: 4 });
		expect(r).toMatchObject({ rating_gag: 4, rating_likeness: null, rating_seamlessness: null, rating_instructions: null });
		expect(rateVersion(db, v.id, { gag: null }, 'nice').note).toBe('nice');
	});
	it('projectStats', () => {
		const p = proj();
		ver(p.id, 'failed');
		const v2 = ver(p.id);
		req(p.id, 'ok', 0.07); req(p.id, 'no_image', 0.01); req(p.id, 'ok', 0.07);
		expect(projectStats(db, p.id)).toEqual({ tries: 2, failures: 1, triesToKeeper: null, spendUsd: 0.15 });
		updateProject(db, p.id, { keeper_version_id: v2.id });
		expect(projectStats(db, p.id).triesToKeeper).toBe(2);
	});
	it('listProjects newest first with version_count and keeper_rel; cascade delete', () => {
		const a = proj('a'), b = proj('b');
		const v = ver(a.id); ver(a.id);
		updateProject(db, a.id, { keeper_version_id: v.id });
		const l = listProjects(db);
		expect(l.map((x) => x.title)).toEqual(['b', 'a']);
		expect(l[1]).toMatchObject({ version_count: 2, keeper_rel: 'i.png' });
		expect(l[0]).toMatchObject({ version_count: 0, keeper_rel: null });
		db.prepare('DELETE FROM cover_projects WHERE id = ?').run(a.id);
		expect(listVersions(db, a.id)).toEqual([]);
		void b;
	});
	it('paths guard', () => {
		expect(coverRoot().endsWith('cover-factory')).toBe(true);
		expect(coverFile('x/y.png').startsWith(coverRoot())).toBe(true);
		expect(() => coverFile('../x')).toThrow();
	});
});
