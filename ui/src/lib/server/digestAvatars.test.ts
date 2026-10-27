import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import {
	buildDigestFaces,
	cropRect,
	digestFaceLookup,
	getDigestAvatarSet,
	listDigestAvatarOptions,
	setDigestAvatarSet,
} from './digestAvatars.js';

let db: Database.Database;
let root: string;

// A 200×100 image: left half red, right half blue. A face box on the right half must
// come out blue — so the crop box is honoured, not just a centre crop.
async function writeImage(path: string) {
	mkdirSync(join(path, '..'), { recursive: true });
	const left = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }).png().toBuffer();
	await sharp({ create: { width: 200, height: 100, channels: 3, background: '#0000ff' } })
		.composite([{ input: left, left: 0, top: 0 }])
		.png()
		.toFile(path);
}

beforeEach(async () => {
	db = openLeagueDb(':memory:');
	db.exec(`INSERT INTO players (id, name) VALUES (1, 'Matt Mariani'), (2, 'Jon Black')`);
	root = mkdtempSync(join(tmpdir(), 'dav-'));
	const cand = (rel: string, theme: string, status = 'approved') => ({
		id: rel, themeSlug: theme, letter: 'A', relPath: rel, label: '', rating: null, status, source: 'generated', createdAt: '2026-10-24T00:00:00Z',
	});
	const state = {
		version: 1, costUsd: 0, attemptCount: 0, importIndex: {}, failedCostUsd: 0, styleJobs: [],
		themes: [{ slug: 'gta', name: 'GTA' }, { slug: 'simpsons', name: 'Simpsons' }],
		leagues: {
			'boarz-ii-men': {
				slug: 'boarz-ii-men', name: 'Boarz II Men', groupShots: [],
				members: [
					// factory slug/name differ from players.name: the face must be keyed by players.name
					{ slug: 'mashew', name: 'Mashew', playerId: 1, height: 'avg', notes: '', photoRel: null, candidates: [cand('b/gta/matt.png', 'gta'), cand('b/simpsons/matt.png', 'simpsons', 'candidate')] },
					{ slug: 'jon-black', name: 'Jon Black', playerId: 2, height: 'avg', notes: '', photoRel: null, candidates: [] },
				],
			},
		},
	};
	writeFileSync(join(root, 'state.json'), JSON.stringify(state));
	await writeImage(join(root, 'images', 'b/gta/matt.png'));
	writeFileSync(join(root, 'digest-face-crops.json'), JSON.stringify({ 'b/gta/matt.png': [0.75, 0.5, 0.4] }));
});

describe('digest avatar sets', () => {
	it('stores one set per league and clears it', () => {
		expect(getDigestAvatarSet(db, 'boarz-ii-men')).toBeNull();
		setDigestAvatarSet(db, 'boarz-ii-men', 'gta');
		setDigestAvatarSet(db, 'second-best', 'simpsons');
		expect(getDigestAvatarSet(db, 'boarz-ii-men')).toBe('gta');
		setDigestAvatarSet(db, 'boarz-ii-men', null);
		expect(getDigestAvatarSet(db, 'boarz-ii-men')).toBeNull();
		expect(getDigestAvatarSet(db, 'second-best')).toBe('simpsons');
	});

	it('crop boxes stay inside the image', () => {
		expect(cropRect([0.5, 0.5, 0.4], 1000, 1000)).toEqual({ left: 300, top: 300, width: 400, height: 400 });
		expect(cropRect([0.02, 0.02, 0.3], 1000, 1000)).toEqual({ left: 0, top: 0, width: 300, height: 300 });
		expect(cropRect([0.5, 0.5, 2], 200, 100)).toMatchObject({ width: 100, height: 100 });
	});

	it('cuts faces from approved images with their crop box, keyed by player name', async () => {
		const out = await buildDigestFaces(db, 'boarz-ii-men', 'gta', root);
		expect(out).toEqual({ written: ['Matt Mariani'], missing: ['Jon Black'] });
		const face = join(root, 'digest-faces/boarz-ii-men/gta/matt-mariani.jpg');
		const { width, height } = await sharp(face).metadata();
		expect([width, height]).toEqual([96, 96]);
		const { dominant } = await sharp(face).stats();
		expect(dominant.b).toBeGreaterThan(200); // the right-half box, not a centre crop
		expect(dominant.r).toBeLessThan(60);
	});

	it('only approved images count; a non-approved candidate is not used', async () => {
		const out = await buildDigestFaces(db, 'boarz-ii-men', 'simpsons', root);
		expect(out.written).toEqual([]);
		expect(existsSync(join(root, 'digest-faces/boarz-ii-men/simpsons/matt-mariani.jpg'))).toBe(false);
	});

	it('lookup: null without a set; with a set, a face or null (initials) — never another style', async () => {
		expect(digestFaceLookup(db, 'boarz-ii-men', root)).toBeNull();
		await buildDigestFaces(db, 'boarz-ii-men', 'gta', root);
		setDigestAvatarSet(db, 'boarz-ii-men', 'gta');
		const face = digestFaceLookup(db, 'boarz-ii-men', root)!;
		expect(face('Matt Mariani')).toMatch(/^data:image\/jpeg;base64,/);
		expect(face('Jon Black')).toBeNull();
	});

	it('lists each league with its themes by approved count', async () => {
		setDigestAvatarSet(db, 'boarz-ii-men', 'gta');
		await buildDigestFaces(db, 'boarz-ii-men', 'gta', root);
		expect(listDigestAvatarOptions(db, root)).toEqual([
			{ leagueSlug: 'boarz-ii-men', leagueName: 'Boarz II Men', current: 'gta', built: 1, members: 2, themes: [{ slug: 'gta', name: 'GTA', approved: 1 }] },
		]);
	});
});
