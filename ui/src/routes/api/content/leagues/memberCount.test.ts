import { describe, it, expect, vi } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

// Regression: Boarz II Men showed "8 members" with 9 people in the league.
// The count was COUNT(DISTINCT c.player_id) ... WHERE c.player_id IS NOT NULL,
// so any competitor without a linked players row was silently dropped. Darren
// Paletz registered on 2026-07-20, after the 2026-07-16 player-seeding run that
// created rows for everyone else, so he had player_id NULL and vanished from
// the count. Every member who joins after a seed hits this.

const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

const { GET } = await import('./+server.js');

function seed() {
	db.exec(`
		INSERT INTO leagues (id, slug, name) VALUES (1, 'boarz', 'Boarz II Men');
		INSERT INTO seasons (id, league_id, season_number, status) VALUES (10, 1, 1, 'active');
		INSERT INTO rounds (id, season_id, ml_round_id, name, created_at)
			VALUES (135, 10, 'r135', 'I Heard It Through the Napster', '2026-07-20T00:00:00Z');
		INSERT INTO players (id, name) VALUES (1, 'Mashew');
	`);
	// One competitor WITH a linked player, one WITHOUT (the late joiner).
	db.prepare(
		`INSERT INTO competitors (id, ml_competitor_id, name, player_id) VALUES (?,?,?,?)`,
	).run(1, 'c-mashew', 'Mashew', 1);
	db.prepare(
		`INSERT INTO competitors (id, ml_competitor_id, name, player_id) VALUES (?,?,?,?)`,
	).run(2, 'c-darren', 'Darren Paletz', null);

	for (const [id, competitorId, uri] of [
		[1, 1, 'spotify:track:aaa'],
		[2, 2, 'spotify:track:bbb'],
	] as const) {
		db.prepare(
			`INSERT INTO ml_submissions (id, round_id, competitor_id, spotify_uri, title, artists, created_at)
			 VALUES (?, 135, ?, ?, 'Song', 'Artist', '2026-07-20T00:00:00Z')`,
		).run(id, competitorId, uri);
	}
}

describe('content leagues — member count', () => {
	it('counts competitors with no linked players row', async () => {
		seed();
		const res = await GET({} as never);
		const body = (await res.json()) as { id: number; members: number }[];
		const boarz = body.find((l) => l.id === 1);
		// Two competitors submitted; only one has a players row. Both are members.
		expect(boarz?.members).toBe(2);
	});
});
