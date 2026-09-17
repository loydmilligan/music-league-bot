import { it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason } from './leagues.js';
import { upsertRound } from './rounds.js';
import {
	SCORED_POINTS_SQL,
	SCORED_UPVOTERS_SQL,
	SCORED_DOWNVOTERS_SQL,
	seasonRoundIdsInPlayOrder,
} from './scoring.js';

let db: Database.Database;
beforeEach(() => {
	db = openLeagueDb(':memory:');
});

/** The real R151 board, which is what forced these rules into existence. */
function seedR151(db: Database.Database) {
	seedLeagues(db);
	const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='boarz-ii-men'").get() as { id: number }).id;
	const seasonId = upsertSeason(db, leagueId, 1, 'active');
	const r = upsertRound(db, seasonId, {
		mlRoundId: 'plot', name: 'Plot so Thicc', description: '', spotifyPlaylistUrl: '',
		createdAt: '2026-09-10T00:00:00Z',
	});
	const ids: Record<string, number> = {};
	const cstmt = db.prepare('INSERT INTO competitors (ml_competitor_id, name) VALUES (?, ?)');
	// Four submitters plus six bystanders to act as voters, so every ballot below
	// is a distinct (round, voter, uri) and nothing collides.
	for (const n of ['Steiny', 'Paletz', 'Grant', 'Shane', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
		ids[n] = Number(cstmt.run(`c-${n}`, n).lastInsertRowid);
	}
	const sub = db.prepare('INSERT INTO ml_submissions (round_id, competitor_id, spotify_uri, title, artists, created_at) VALUES (?,?,?,?,?,?)');
	const vote = db.prepare('INSERT INTO votes (round_id, voter_id, spotify_uri, points, created_at) VALUES (?,?,?,?,?)');
	const now = '2026-09-10T00:00:00Z';
	sub.run(r, ids.Steiny, 'uri:snake', 'The Snake', 'Al Wilson', now);
	sub.run(r, ids.Paletz, 'uri:wars', 'Secret Wars I', 'The Last Emperor', now);
	sub.run(r, ids.Grant, 'uri:rocky', 'Rocky Raccoon', 'The Beatles', now);
	sub.run(r, ids.Shane, 'uri:kids', "The Kids Aren't Alright", 'The Offspring', now);

	const cast = (uri: string, ballots: ReadonlyArray<readonly [string, number]>) => {
		for (const [v, p] of ballots) vote.run(r, ids[v], uri, p, now);
	};
	// Steiny: 5 upvoters (8 pts) + 1 downvoter → 7.
	cast('uri:snake', [['V1', 3], ['V2', 2], ['V3', 1], ['V4', 1], ['V5', 1], ['V6', -1]]);
	// Paletz: 4 upvoters (8 pts) + 1 downvoter → 7. Tied with Steiny on points,
	// one fewer upvoter — the tiebreak has to separate them.
	cast('uri:wars', [['V1', 3], ['V2', 3], ['V3', 1], ['V4', 1], ['V5', -1]]);
	// Grant: 4 upvoters (10 pts) + 1 downvoter → 9 raw. He files no ballot.
	cast('uri:rocky', [['V1', 3], ['V2', 3], ['V3', 2], ['V4', 2], ['V5', -1]]);
	// Shane: 2 upvoters (4 pts) + 2 downvoters → 2 raw. He files no ballot.
	cast('uri:kids', [['V1', 2], ['V2', 2], ['V3', -1], ['V4', -1]]);
	// Steiny and Paletz DID vote; Grant and Shane did not. That asymmetry is the
	// whole point of the fixture.
	vote.run(r, ids.Steiny, 'uri:wars', 0, now);
	vote.run(r, ids.Paletz, 'uri:snake', 0, now);
	return { r, ids };
}

function board(db: Database.Database, roundId: number) {
	return db
		.prepare(
			`SELECT c.name AS submitter,
              ${SCORED_POINTS_SQL} AS points,
              ${SCORED_UPVOTERS_SQL} AS upvoters,
              ${SCORED_DOWNVOTERS_SQL} AS downvoters
       FROM ml_submissions m
       LEFT JOIN competitors c ON c.id = m.competitor_id
       LEFT JOIN votes v ON v.round_id = m.round_id AND v.spotify_uri = m.spotify_uri
       WHERE m.round_id = ?
       GROUP BY m.id
       ORDER BY points DESC, upvoters DESC, downvoters ASC`,
		)
		.all(roundId) as { submitter: string; points: number; upvoters: number; downvoters: number }[];
}

it('scores the real R151 board the way Music League does', () => {
	const { r } = seedR151(db);
	expect(board(db, r).map((x) => [x.submitter, x.points])).toEqual([
		['Steiny', 7],   // wins the 7-7 tie on upvoters
		['Paletz', 7],
		['Grant', -1],   // 9 raw → upvotes voided, the lone downvote stands
		['Shane', -2],   // 2 raw → upvotes voided, both downvotes stand
	]);
	// Grant led on raw points (9) and must not be anywhere near the top.
	expect(board(db, r)[0].submitter).not.toBe('Grant');
});

it('breaks a points tie on upvoter count, not insertion order', () => {
	const { r } = seedR151(db);
	const [first, second] = board(db, r);
	expect(first.points).toBe(second.points); // genuinely tied on points
	expect(first.upvoters).toBeGreaterThan(second.upvoters);
	expect(first.submitter).toBe('Steiny');
});

it('zeroes the upvoter count of a voided song so it cannot win a tiebreak on it', () => {
	const { r } = seedR151(db);
	const grant = board(db, r).find((x) => x.submitter === 'Grant')!;
	expect(grant.upvoters).toBe(0);   // had 4 real upvoters
	expect(grant.downvoters).toBe(1); // downvotes still counted
});

it('orders a season by play date, falling back when deadlines are null', () => {
	seedLeagues(db);
	const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='sssc'").get() as { id: number }).id;
	const seasonId = upsertSeason(db, leagueId, 1, 'active');
	const a = upsertRound(db, seasonId, { mlRoundId: 'a', name: 'a', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
	const b = upsertRound(db, seasonId, { mlRoundId: 'b', name: 'b', description: '', spotifyPlaylistUrl: '', createdAt: '2026-02-01T00:00:00Z' });
	const c = upsertRound(db, seasonId, { mlRoundId: 'c', name: 'c', description: '', spotifyPlaylistUrl: '', createdAt: '2026-03-01T00:00:00Z' });
	// `c` has the largest id but the earliest deadline; `b` has none at all and
	// must fall back to created_at rather than dropping out or sorting first.
	db.prepare('UPDATE rounds SET voting_deadline = ? WHERE id = ?').run('2026-06-01T00:00:00Z', a);
	db.prepare('UPDATE rounds SET voting_deadline = NULL WHERE id = ?').run(b);
	db.prepare('UPDATE rounds SET voting_deadline = ? WHERE id = ?').run('2026-01-15T00:00:00Z', c);
	// c (Jan 15) → b (created Feb 1) → a (Jun 1)
	expect(seasonRoundIdsInPlayOrder(db, seasonId)).toEqual([c, b, a]);
});
