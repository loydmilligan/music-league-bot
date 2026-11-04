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
import { fetchTrack } from '$lib/spotify/client.js';
import {
	listRoundSongs, resolveSpotifyCover, fetchCoverBytes, listPlayers, loadHeadshot,
	saveHeadshotUpload, saveCoverUpload, submitterOfSubmission,
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

describe('Spotify Web API down: oEmbed fallback', () => {
	const oembed = vi.fn(async (u: unknown) => {
		const url = String(u);
		if (!url.startsWith('https://open.spotify.com/oembed?url=')) throw new Error(`unexpected ${url}`);
		return new Response(
			JSON.stringify({ title: 'Dancing Queen', thumbnail_url: 'https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02abc' }),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		);
	});
	beforeEach(() => {
		oembed.mockClear();
	});

	it('listRoundSongs fills missing art from oEmbed (640 px) and caches it when ensureAlbumArt throws', async () => {
		const db = fixture();
		db.exec(`INSERT INTO ml_submissions VALUES (2,7,1,'spotify:track:nope','S2','B2',NULL);`);
		vi.mocked(ensureAlbumArt).mockRejectedValueOnce(new Error('Spotify 403'));
		const songs = await listRoundSongs(db, 7, oembed);
		const art = 'https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273abc';
		expect(songs.find((s) => s.submissionId === 2)!.artUrl).toBe(art);
		expect(songs.find((s) => s.submissionId === 1)!.artUrl).toBe('https://i.scdn.co/a.jpg');
		expect(oembed).toHaveBeenCalledTimes(1);
		expect(String(oembed.mock.calls[0][0])).toContain(encodeURIComponent('https://open.spotify.com/track/nope'));
		expect((db.prepare('SELECT album_art_url AS a FROM ml_submissions WHERE id = 2').get() as { a: string }).a).toBe(art);
	});

	it('listRoundSongs still lists songs when ensureAlbumArt and oEmbed both fail', async () => {
		const db = fixture();
		db.exec(`INSERT INTO ml_submissions VALUES (2,7,1,'spotify:track:nope','S2','B2',NULL);`);
		vi.mocked(ensureAlbumArt).mockRejectedValueOnce(new Error('Spotify 403'));
		const songs = await listRoundSongs(db, 7, async () => new Response('x', { status: 500 }));
		expect(songs.map((s) => [s.submissionId, s.artUrl])).toEqual([[2, null], [1, 'https://i.scdn.co/a.jpg']]);
	});

	it('resolveSpotifyCover falls back to oEmbed when the Web API fails', async () => {
		vi.mocked(fetchTrack).mockRejectedValueOnce(new Error('Spotify 403'));
		const r = await resolveSpotifyCover('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=1', oembed);
		expect(r).toEqual({
			title: 'Dancing Queen', artists: '',
			artUrl: 'https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273abc',
			spotifyUri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
		});
	});
});

describe('9a: oEmbed concurrency + listPlayers dedupe + submitterOfSubmission', () => {
	it('oEmbed fallback never runs more than 4 requests at once', async () => {
		const db = fixture();
		for (let i = 10; i < 22; i++) db.exec(`INSERT INTO ml_submissions VALUES (${i},7,1,'spotify:track:t${i}','S','B',NULL);`);
		vi.mocked(ensureAlbumArt).mockRejectedValueOnce(new Error('Spotify 403'));
		let inFlight = 0, peak = 0;
		const f = (async () => {
			inFlight++; peak = Math.max(peak, inFlight);
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			return new Response(JSON.stringify({ title: 't', thumbnail_url: 'https://x.test/ab67616d00001e02q' }), { status: 200 });
		}) as any;
		const songs = await listRoundSongs(db, 7, f);
		expect(songs.every((s) => s.artUrl)).toBe(true);
		expect(peak).toBe(4);
	});

	it('listPlayers dedupes by slug, keeping the first', () => {
		const db = fixture();
		db.exec(`INSERT INTO players VALUES (104,'Ann Lee','mlA2'); INSERT INTO season_players VALUES (1,104);`);
		db.close();
		const slugs = listPlayers('second-best').map((p) => p.slug);
		expect(slugs.filter((x) => x === 'ann-lee')).toHaveLength(1);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	it('submitterOfSubmission resolves with no network and undefined for unknown ids', () => {
		const db = fixture();
		expect(submitterOfSubmission(db, 1)).toEqual({ slug: 'ann-lee', name: 'Ann Lee' });
		expect(submitterOfSubmission(db, 999)).toBeUndefined();
	});

	it('prefers ml_submissions.player_id over an ML display name that matches no player (live R139 bug)', async () => {
		const db = fixture();
		db.exec(`ALTER TABLE ml_submissions ADD COLUMN player_id INT;
		         INSERT INTO competitors VALUES (2,'mlZ','queen0reno');
		         INSERT INTO ml_submissions VALUES (2,7,2,'spotify:track:y','Song2','Band2','https://i.scdn.co/b.jpg',102);`);
		expect(submitterOfSubmission(db, 2)).toEqual({ slug: 'bob-ray', name: 'Bob Ray' });
		const songs = await listRoundSongs(db, 7);
		expect(songs.find((s) => s.submissionId === 2)).toMatchObject({ playerSlug: 'bob-ray', playerName: 'Bob Ray' });
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

describe('fetchCoverBytes hardening', () => {
	it('caps streamed body without content-length', async () => {
		const chunk = new Uint8Array(1024 * 1024);
		let n = 0;
		const body = new ReadableStream({ pull(c) { n++; if (n > 12) c.close(); else c.enqueue(chunk); } });
		const f = (async () => new Response(body, { headers: { 'content-type': 'image/jpeg' } })) as any;
		await expect(fetchCoverBytes('https://x.test/a', f)).rejects.toThrow(/large/);
		expect(n).toBeLessThan(13);
	});
	it('rejects redirect to http, follows redirect to https', async () => {
		const to = (loc: string) => (async (u: string) =>
			u === 'https://x.test/a'
				? new Response(null, { status: 302, headers: { location: loc } })
				: new Response(await img(8), { headers: { 'content-type': 'image/png' } })) as any;
		await expect(fetchCoverBytes('https://x.test/a', to('http://internal/x'))).rejects.toThrow(/https/);
		expect((await fetchCoverBytes('https://x.test/a', to('https://y.test/b'))).length).toBeGreaterThan(0);
	});
});

describe('players + headshots', () => {
	it('Boarz ids map to roster slugs in songs and players', async () => {
		const db = fixture();
		db.exec(`INSERT INTO leagues VALUES (2,'boarz-ii-men','Boarz'); INSERT INTO seasons VALUES (2,2,1);
		INSERT INTO players VALUES (1,'Matthew Mariani','mlM'); INSERT INTO season_players VALUES (2,1);
		INSERT INTO competitors VALUES (2,'mlM','Matthew Mariani');
		INSERT INTO ml_submissions VALUES (2,7,2,'spotify:track:y','S2','B2',NULL);`);
		const songs = await listRoundSongs(db, 7);
		expect(songs.find((s) => s.submissionId === 2)!.playerSlug).toBe('matt-mariani');
		expect(listPlayers('boarz-ii-men')[0].slug).toBe('matt-mariani');
	});
	it('listPlayers reflects project upload', async () => {
		fixture();
		const dir = join(process.env.AVATAR_SOURCES_DIR!, 'second-best-players', 'ann-lee');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'headshot.png'), await img(96));
		await saveHeadshotUpload(9, 'ann-lee', await img(600));
		const ann = (l: any[]) => l.find((p) => p.slug === 'ann-lee');
		expect(ann(listPlayers('second-best'))).toMatchObject({ lowRes: true });
		expect(ann(listPlayers('second-best', 9))).toMatchObject({ lowRes: false, missing: false });
	});
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
