import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA } from '$lib/db/schema.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', () => ({ getDb: () => db }));
const publishDigest2 = vi.fn();
vi.mock('$lib/digest2/publish.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/digest2/publish.js')>()),
	publishDigest2: (id: number) => publishDigest2(id)
}));
const writePortalJson = vi.fn();
vi.mock('$lib/portal/portalJson.js', () => ({ writePortalJson: (...a: unknown[]) => writePortalJson(...a) }));
const { POST } = await import('./+server.js');
const { Digest2PublishError } = await import('$lib/digest2/publish.js');

beforeEach(() => {
	publishDigest2.mockReset();
	writePortalJson.mockReset();
	writePortalJson.mockResolvedValue({ path: 'p', digests: 0 });
	db = new Database(':memory:');
	db.exec(SCHEMA);
	db.exec(`INSERT INTO leagues (id, slug, name) VALUES (1, 'bz', 'Boarz');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (1, 1, 1, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at) VALUES (152, 1, 'ml-152', 'R', '2026-09-01T00:00:00Z');`);
});
const call = (roundId: string) => POST({ params: { roundId } } as never);

describe('POST /api/digest2/:roundId/publish', () => {
	it('400 on a non-integer id', async () => { await expect(call('abc')).rejects.toMatchObject({ status: 400 }); });
	it('404 on an unknown round', async () => { await expect(call('999')).rejects.toMatchObject({ status: 404 }); });
	it('409 when the round has no 1.0 story draft, and never renders', async () => {
		await expect(call('152')).rejects.toMatchObject({ status: 409 });
		expect(publishDigest2).not.toHaveBeenCalled();
	});
	it('200 with the digest-host url on success', async () => {
		db.exec(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json) VALUES ('d', 152, '{}', '{}', '{}')`);
		publishDigest2.mockResolvedValue({ slug: 's', url: 'https://digest.example/d2/s', files: 3, bytes: 10 });
		const res = await call('152');
		const body = await res.json();
		expect(body).toMatchObject({ url: 'https://digest.example/d2/s' });
		expect(body.portalWarning).toBeUndefined();
		expect(writePortalJson).toHaveBeenCalledTimes(1);
		expect(writePortalJson).toHaveBeenCalledWith(db, 1);
	});
	it('still 200 with a portalWarning when portal.json fails', async () => {
		db.exec(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json) VALUES ('d', 152, '{}', '{}', '{}')`);
		publishDigest2.mockResolvedValue({ slug: 's', url: 'https://digest.example/d2/s', files: 3, bytes: 10 });
		writePortalJson.mockRejectedValue(new Error('disk full'));
		const body = await (await call('152')).json();
		expect(body.url).toBe('https://digest.example/d2/s');
		expect(body.portalWarning).toContain('disk full');
	});
	it('maps a leak-scan failure to 422 with the message', async () => {
		db.exec(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json) VALUES ('d', 152, '{}', '{}', '{}')`);
		publishDigest2.mockRejectedValue(new Digest2PublishError(422, 'leak: index.html root-relative href="/stats"'));
		await expect(call('152')).rejects.toMatchObject({ status: 422, body: { message: expect.stringContaining('/stats') } });
		expect(writePortalJson).not.toHaveBeenCalled();
	});
});
