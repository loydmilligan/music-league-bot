import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';

vi.mock('$lib/digest/albumArt.js', () => ({ ensureAlbumArt: vi.fn(async () => 0) }));
vi.mock('$lib/spotify/client.js', async (orig) => ({
	...(await orig<typeof import('$lib/spotify/client.js')>()),
	fetchTrack: vi.fn(async (id: string) => ({
		id, uri: `spotify:track:${id}`, title: 'T', artist: 'A', albumArtUrl: 'https://i.scdn.co/x.jpg',
	})),
}));

import { ensureAlbumArt } from '$lib/digest/albumArt.js';
import {
	listRoundSongs, resolveSpotifyCover, fetchCoverBytes, listPlayers, loadHeadshot,
	saveHeadshotUpload, saveCoverUpload,
} from './inputs.js';

const img = (n: number) =>
	sharp({ create: { width: n, height: n, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer();

let tmp: string;
const saved = { ...process.env };
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), 'cf-inputs-'));
	process.env.AVATAR_SOURCES_DIR = join(tmp, 'src');
	process.env.DATA_DIR = join(tmp, 'data');
});
afterEach(() => {
	process.env = { ...saved };
	rmSync(tmp, { recursive: true, force: true });
});

function fixture() {
	mkdirSync(process.env.DATA_DIR!, { recursive: true });
	const path = join(process.env.DATA_DIR!, 'league.db');
	const db = new Database(path);
	db.exec(`
	CREATE TABLE leagues (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
	CREATE TABLE seasons (id INTEGER PRIMARY KEY, league_id INT, season_number INT);
	CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT, ml_competitor_id TEXT);
	CREATE TABLE season_players (season_id INT, player_id INT);
	CREATE TABLE rounds (id INTEGER PRIMARY KEY, season_id INT);
	CREATE TABLE competitors (id INTEGER PRIMARY KEY, ml_competitor_id TEXT, name TEXT);
	CREATE TABLE ml_submissions (id INTEGER PRIMARY KEY, round_id INT, competitor_id INT, spotify_uri TEXT, title TEXT, artists TEXT, album_art_url TEXT);
	INSERT INTO leagues VALUES (1,'second-best','Second Best');
	INSERT INTO seasons VALUES (1,1,1);
	INSERT INTO players VALUES (101,'Ann Lee','mlA'),(102,'Bob Ray','mlB'),(103,'Cy Fox','mlC');
	INSERT INTO season_players VALUES (1,101),(1,102),(1,103);
	INSERT INTO rounds VALUES (7,1);
	INSERT INTO competitors VALUES (1,'mlA','Ann Lee');
	INSERT INTO ml_submissions VALUES (1,7,1,'spotify:track:x','Song','Band','https://i.scdn.co/a.jpg');
	`);
	return db;
}

describe('listRoundSongs', () => {
	it('maps player name + slug and ensures album art first', async () => {
		const db = fixture();
		const songs = await listRoundSongs(db, 7);
		expect(ensureAlbumArt).toHaveBeenCalledWith(db, 7);
		expect(songs).toEqual([
			{ submissionId: 1, title: 'Song', artists: 'Band', playerName: 'Ann Lee', playerSlug: 'ann-lee', artUrl: 'https://i.scdn.co/a.jpg' },
		]);
	});
});

describe('spotify + cover bytes', () => {
	it('rejects non-Spotify links', async () => {
		await expect(resolveSpotifyCover('https://example.com')).rejects.toThrow('not a Spotify track link');
	});
	it('resolves a track link', async () => {
		const r = await resolveSpotifyCover('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
		expect(r).toMatchObject({ title: 'T', artists: 'A', spotifyUri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' });
	});
	it('https only', async () => {
		await expect(fetchCoverBytes('http://x.test/a.jpg')).rejects.toThrow(/https/);
	});
	it('rejects non-image and oversized', async () => {
		const html = (async () => new Response('x', { headers: { 'content-type': 'text/html' } })) as any;
		await expect(fetchCoverBytes('https://x.test/a', html)).rejects.toThrow(/image/);
		const big = (async () => new Response(Buffer.alloc(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } })) as any;
		await expect(fetchCoverBytes('https://x.test/a', big)).rejects.toThrow(/large|10/);
	});
	it('returns image bytes', async () => {
		const ok = (async () => new Response(await img(8), { headers: { 'content-type': 'image/png' } })) as any;
		expect((await fetchCoverBytes('https://x.test/a', ok)).length).toBeGreaterThan(0);
	});
});

describe('players + headshots', () => {
	it('flags lowRes and missing', async () => {
		fixture();
		const dir = join(process.env.AVATAR_SOURCES_DIR!, 'second-best-players');
		mkdirSync(join(dir, 'ann-lee'), { recursive: true });
		mkdirSync(join(dir, 'bob-ray'), { recursive: true });
		writeFileSync(join(dir, 'ann-lee', 'headshot.png'), await img(96));
		writeFileSync(join(dir, 'bob-ray', 'headshot.jpg'), await sharp(await img(512)).jpeg().toBuffer());
		const by = Object.fromEntries((await listPlayersAsync()).map((p) => [p.slug, p]));
		expect(by['ann-lee']).toMatchObject({ lowRes: true, missing: false, leagueSlug: 'second-best' });
		expect(by['bob-ray']).toMatchObject({ lowRes: false, missing: false });
		expect(by['cy-fox']).toMatchObject({ missing: true, headshotRel: null });
	});
	async function listPlayersAsync() {
		return listPlayers('second-best');
	}
	it('loadHeadshot prefers project upload', async () => {
		fixture();
		const dir = join(process.env.AVATAR_SOURCES_DIR!, 'second-best-players', 'ann-lee');
		mkdirSync(dir, { recursive: true });
		const orig = await img(300);
		writeFileSync(join(dir, 'headshot.png'), orig);
		const p = listPlayers('second-best').find((x) => x.slug === 'ann-lee')!;
		expect((await loadHeadshot(5, p))!.equals(orig)).toBe(true);
		const rel = await saveHeadshotUpload(5, 'ann-lee', await img(64));
		expect(existsSync(join(process.env.DATA_DIR!, 'cover-factory', rel))).toBe(true);
		const got = await loadHeadshot(5, p);
		expect(got!.equals(orig)).toBe(false);
		const missing = listPlayers('second-best').find((x) => x.slug === 'cy-fox')!;
		expect(await loadHeadshot(5, missing)).toBeNull();
	});
	it('saveCoverUpload writes covers/<random>.jpg', async () => {
		const a = await saveCoverUpload(await img(32));
		const b = await saveCoverUpload(await img(32));
		expect(a).toMatch(/^covers\/[0-9a-f]+\.jpg$/);
		expect(a).not.toBe(b);
	});
});
