import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import { buildDigest2Ballot } from './ballot.js';

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
});

function seedNonVoterRound(db: Database.Database) {
	seedLeagues(db);
	const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='boarz-ii-men'").get() as { id: number }).id;
	const seasonId = upsertSeason(db, leagueId, 1, 'active');
	const r = upsertRound(db, seasonId, {
		mlRoundId: 'nv-ballot',
		name: 'R',
		description: '',
		spotifyPlaylistUrl: '',
		createdAt: '2026-01-01T00:00:00Z',
	});
	const ids: Record<string, number> = {};
	const cstmt = db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)');
	for (const n of ['Jensen', 'Jimmy', 'Paletz', 'Berto']) {
		ids[n] = Number(cstmt.run(`b-${n}`, n).lastInsertRowid);
	}
	const sub = db.prepare(
		'INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?,?,?,?,?,?)',
	);
	const vote = db.prepare('INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?,?,?,?,?)');
	const now = '2026-01-01T00:00:00Z';
	sub.run(r, ids.Jensen, 'uri:love', 'Love and Death', '["Ebo Taylor"]', now);
	sub.run(r, ids.Jimmy, 'uri:tou', 'Toubouk', '["Etran"]', now);
	sub.run(r, ids.Paletz, 'uri:hard', "What's Hardcore?", '["K\'NAAN"]', now);
	sub.run(r, ids.Berto, 'uri:radio', 'Radio Ga Ga', '["Queen"]', now);
	// Jensen 11 (6+5) and Jimmy 11 (11) tie on net AND summed upvotes; no downs → title order.
	vote.run(r, ids.Jimmy, 'uri:love', 6, now);
	vote.run(r, ids.Berto, 'uri:love', 5, now);
	vote.run(r, ids.Jensen, 'uri:tou', 11, now);
	// Paletz raw +4 (5 up / −1 down) but files no ballot → scored −1.
	vote.run(r, ids.Jensen, 'uri:hard', 5, now);
	vote.run(r, ids.Jimmy, 'uri:hard', -1, now);
	vote.run(r, ids.Jensen, 'uri:radio', -3, now);
	vote.run(r, ids.Jimmy, 'uri:radio', -3, now);
	// Jensen, Jimmy, Berto file ballots (zero rows count). Paletz does not.
	vote.run(r, ids.Berto, 'uri:tou', 0, now);
	return r;
}

it('scores a non-voter song as downs-only, ranks by scored net, and marks the forfeit', () => {
	const r = seedNonVoterRound(db);
	const ballot = buildDigest2Ballot(db, r);
	expect(ballot).not.toBeNull();
	const songs = ballot!.songs.map((s) => [s.rank, s.submitter, s.net, s.rawNet, s.ups, s.rawUps, s.forfeited]);
	expect(songs).toEqual([
		[1, 'Jensen', 11, 11, 2, 2, false],
		[2, 'Jimmy', 11, 11, 1, 1, false],
		[3, 'Paletz', -1, 4, 0, 1, true],
		[4, 'Berto', -6, -6, 0, 0, false],
	]);
	expect(ballot!.villainRank).toBe(4);
});

it('with an Avatar Factory set chosen, faces come from that set only; missing players get initials', async () => {
	const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	const { tmpdir } = await import('node:os');
	const { setDigestAvatarSet } = await import('$lib/server/digestAvatars.js');
	const r = seedNonVoterRound(db);
	const dataDir = mkdtempSync(join(tmpdir(), 'ballot-faces-'));
	const dir = join(dataDir, 'avatar-factory/digest-faces/boarz-ii-men/gta');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'jensen.jpg'), Buffer.from('fake-jpeg'));
	const prev = process.env.DATA_DIR;
	process.env.DATA_DIR = dataDir;
	try {
		// Jimmy has a built-in crop (avatars/boarz-ii-men/jimmy.jpg): the set must not fall back to it.
		expect(buildDigest2Ballot(db, r)!.songs.find((s) => s.submitter === 'Jimmy')!.submitterAvatar).toBe('av-jimmy');
		setDigestAvatarSet(db, 'boarz-ii-men', 'gta');
		const ballot = buildDigest2Ballot(db, r)!;
		const jensen = ballot.songs.find((s) => s.submitter === 'Jensen')!;
		const jimmy = ballot.songs.find((s) => s.submitter === 'Jimmy')!;
		expect(jensen.submitterAvatar).toBe('av-jensen');
		expect(jimmy.submitterAvatar).toBeNull();
		expect(ballot.avatarCss).toContain(`.av-jensen{background-image:url(data:image/jpeg;base64,${Buffer.from('fake-jpeg').toString('base64')})}`);
		expect(ballot.avatarCss).not.toContain('av-jimmy');
	} finally {
		if (prev === undefined) delete process.env.DATA_DIR;
		else process.env.DATA_DIR = prev;
	}
});

it('breaks a points tie on SUMMED upvote points, not the number of upvoters (matches ML + standings)', () => {
	seedLeagues(db);
	const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='boarz-ii-men'").get() as { id: number }).id;
	const seasonId = upsertSeason(db, leagueId, 1, 'active');
	const r = upsertRound(db, seasonId, { mlRoundId: 'tie-sum', name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
	const c = db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)');
	const ids: Record<string, number> = {};
	for (const n of ['Ann', 'Bob', 'Cy', 'Di', 'Ed']) ids[n] = Number(c.run(`t-${n}`, n).lastInsertRowid);
	const sub = db.prepare('INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?,?,?,?,?,?)');
	const vote = db.prepare('INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?,?,?,?,?)');
	const now = '2026-01-01T00:00:00Z';
	sub.run(r, ids.Ann, 'uri:a', 'Alpha', '["X"]', now);
	sub.run(r, ids.Bob, 'uri:b', 'Bravo', '["X"]', now);
	// Both net 10. Alpha: three upvoters summing 10. Bravo: two upvoters summing 12, one -2.
	// By upvoter COUNT Alpha wins; by SUMMED upvote points (ML's rule) Bravo wins.
	vote.run(r, ids.Bob, 'uri:a', 4, now);
	vote.run(r, ids.Cy, 'uri:a', 3, now);
	vote.run(r, ids.Di, 'uri:a', 3, now);
	vote.run(r, ids.Cy, 'uri:b', 6, now);
	vote.run(r, ids.Di, 'uri:b', 6, now);
	vote.run(r, ids.Ed, 'uri:b', -2, now);
	vote.run(r, ids.Ann, 'uri:b', 0, now);
	const ballot = buildDigest2Ballot(db, r)!;
	expect(ballot.songs.map((s) => [s.rank, s.title, s.net])).toEqual([
		[1, 'Bravo', 10],
		[2, 'Alpha', 10],
	]);
});
