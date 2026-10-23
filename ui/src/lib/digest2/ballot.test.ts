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
	// Jensen 11 from 2 upvoters; Jimmy 11 from 1 upvoter → Jensen ranks above.
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

it('scores a non-voter song as downs-only, ranks by scored net then upvoters, and marks the forfeit', () => {
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
