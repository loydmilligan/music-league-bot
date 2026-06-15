import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openLeagueDb } from '$lib/db/client.js';

// Shared in-memory DB injected into all handlers under test.
const db = openLeagueDb(':memory:');

vi.mock('$lib/db/client.js', async (orig) => {
	const actual = await orig<typeof import('$lib/db/client.js')>();
	return { ...actual, getDb: () => db };
});

// Prevent file-system writes from publish artifacts.
vi.mock('node:fs/promises', () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

// LLM / prediction stubs — should not be called with all-lock/hold decisions.
vi.mock('$lib/predict/predict.js', () => ({ runPrediction: vi.fn() }));

vi.mock('$lib/dashboard/generators/deterministic.js', async (orig) => {
	const actual = await orig<typeof import('$lib/dashboard/generators/deterministic.js')>();
	return {
		...actual,
		buildDeterministicSlices: vi.fn().mockReturnValue({
			members: new Map(),
			league: {
				kpis: [{ value: '0', label: 'songs submitted', sub: 'test' }],
				moments: null,
			},
		}),
	};
});

vi.mock('$lib/dashboard/generators/overlap.js', async (orig) => {
	const actual = await orig<typeof import('$lib/dashboard/generators/overlap.js')>();
	return { ...actual, buildOverlap: vi.fn().mockReturnValue(new Map()) };
});

// Preserve Zod schemas; only stub the async LLM-backed function.
vi.mock('$lib/dashboard/generators/profile.js', async (orig) => {
	const actual = await orig<typeof import('$lib/dashboard/generators/profile.js')>();
	return { ...actual, generateProfile: vi.fn().mockResolvedValue(null) };
});

vi.mock('$lib/predict/tasks/tasteFingerprint.js', async (orig) => {
	const actual = await orig<typeof import('$lib/predict/tasks/tasteFingerprint.js')>();
	return {
		...actual,
		generateFingerprint: vi.fn().mockResolvedValue({
			fingerprint: {
				signature_artists: [],
				genres: [],
				eras: [],
				rewards: [],
				punishes: [],
				summary: '',
				confidence: 'low',
			},
		}),
	};
});

// Preserve schemas; stub only the async read-model builder (used by publishSite in test d).
vi.mock('$lib/dashboard/buildReadModel.js', async (orig) => {
	const actual = await orig<typeof import('$lib/dashboard/buildReadModel.js')>();
	return {
		...actual,
		buildReadModel: vi.fn().mockResolvedValue({
			league: {
				name: 'Test',
				slug: 'test-slug',
				season: 1,
				round: 1,
				seasons: 1,
				memberCount: 0,
				updated: '2026-01-01T00:00:00Z',
			},
			members: [],
			reel: [],
			kpis: [{ value: '0', label: 'songs submitted', sub: 'test' }],
			moments: null,
			archive: [],
		}),
	};
});

// Route handlers — loaded lazily so mocks are in place first.
let GET_leagues: typeof import('./leagues/+server.js').GET;
let GET_updatePlan: typeof import('./[leagueId]/update-plan/+server.js').GET;
let POST_update: typeof import('./[leagueId]/update/+server.js').POST;
let POST_reshare: typeof import('./[leagueId]/reshare/+server.js').POST;

beforeEach(async () => {
	db.pragma('foreign_keys = OFF');
	for (const t of [
		'dashboard_section_state',
		'dashboard_sites',
		'digest_shares',
		'digest_sections',
		'digest_drafts',
		'votes',
		'ml_submissions',
		'rounds',
		'competitors',
		'seasons',
		'players',
		'leagues',
	]) {
		try {
			db.prepare(`DELETE FROM ${t}`).run();
		} catch {
			// table may not exist in :memory: schema variant — skip
		}
	}
	db.pragma('foreign_keys = ON');

	({ GET: GET_leagues } = await import('./leagues/+server.js'));
	({ GET: GET_updatePlan } = await import('./[leagueId]/update-plan/+server.js'));
	({ POST: POST_update } = await import('./[leagueId]/update/+server.js'));
	({ POST: POST_reshare } = await import('./[leagueId]/reshare/+server.js'));
});

// ── DB seed helpers ───────────────────────────────────────────────────────────

function insertLeague(slug: string, name: string): number {
	db.prepare('INSERT INTO leagues (slug, name) VALUES (?, ?)').run(slug, name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function insertSeason(leagueId: number, num = 1): number {
	db.prepare(
		"INSERT INTO seasons (league_id, season_number, status) VALUES (?, ?, 'active')",
	).run(leagueId, num);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function insertRound(seasonId: number, name: string): number {
	db.prepare(
		"INSERT INTO rounds (season_id, ml_round_id, name, created_at, voting_deadline) VALUES (?, ?, ?, '2026-01-01', '2026-01-14')",
	).run(seasonId, `ml-${name}-${Math.random()}`, name);
	return (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
}

function insertFinalizedDraft(roundId: number, finalizedAt = '2026-01-15T00:00:00Z'): void {
	db.prepare(
		'INSERT INTO digest_drafts (id, round_id, finalized_at, rel_context, prep_checks) VALUES (?, ?, ?, ?, ?)',
	).run(`draft-${roundId}-${Math.random()}`, roundId, finalizedAt, '{}', '{}');
}

function insertSite(
	leagueId: number,
	slug: string,
	readModel: object,
	archivedRounds: number[],
	refreshedAt?: string,
): void {
	const now = refreshedAt ?? new Date().toISOString();
	db.prepare(
		`INSERT INTO dashboard_sites
		 (slug, league_id, season, read_model, archived_rounds, is_live, published_at, refreshed_at)
		 VALUES (?, ?, 1, ?, ?, 1, ?, ?)`,
	).run(slug, leagueId, JSON.stringify(readModel), JSON.stringify(archivedRounds), now, now);
}

function minimalReadModel(slug: string, archive: object[] = []): object {
	return {
		league: {
			name: 'Test League',
			slug,
			season: 1,
			round: archive.length + 1,
			seasons: 1,
			memberCount: 0,
			updated: '2026-01-01T00:00:00Z',
		},
		members: [],
		reel: [],
		kpis: [{ value: '10', label: 'songs submitted', sub: 'across 1 round' }],
		moments: null,
		archive,
	};
}

function archiveEntry(n: number): object {
	return {
		n,
		season: 1,
		theme: `Round ${n}`,
		winnerSong: 'Song A',
		winnerArtist: 'Artist A',
		submitter: '1',
		date: '2026-01-07',
		votes: 5,
		hue: 'oklch(0.72 0.15 31)',
		digestUrl: null,
	};
}

// ── GET /api/content/leagues ──────────────────────────────────────────────────

describe('GET /api/content/leagues', () => {
	function mkEvt() {
		return {} as unknown as Parameters<typeof GET_leagues>[0];
	}

	it('returns one row per league with bside=null for unpublished leagues', async () => {
		insertLeague('alpha', 'Alpha League');
		insertLeague('beta', 'Beta League');

		const res = await GET_leagues(mkEvt());
		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<{ name: string; bside: null }>;
		expect(body).toHaveLength(2);
		expect(body.every((l) => l.bside === null)).toBe(true);
	});

	it('returns 4 leagues with Fam-Jam published and pending flag accurate', async () => {
		// Fam-Jam (published + has pending update)
		const famJamId = insertLeague('fam-jam', 'Fam-Jam');
		const famSeason = insertSeason(famJamId);
		const famRound1 = insertRound(famSeason, 'Round 1');
		const famRound2 = insertRound(famSeason, 'Round 2'); // pending round
		insertFinalizedDraft(famRound1);
		insertFinalizedDraft(famRound2); // finalized but not yet archived
		insertSite(famJamId, 'fam-jam-slug', minimalReadModel('fam-jam-slug', [archiveEntry(1)]), [
			famRound1,
		]);

		// Three unpublished leagues
		insertLeague('rock-club', 'Rock Club');
		insertLeague('indie-circle', 'Indie Circle');
		insertLeague('pop-squad', 'Pop Squad');

		const res = await GET_leagues(mkEvt());
		const body = (await res.json()) as Array<{
			name: string;
			bside: { slug: string; url: string; archivedCount: number } | null;
			pending: { roundId: number } | null;
		}>;

		expect(body).toHaveLength(4);

		const famJam = body.find((l) => l.name === 'Fam-Jam');
		expect(famJam).toBeDefined();
		expect(famJam!.bside).not.toBeNull();
		expect(famJam!.bside!.slug).toBe('fam-jam-slug');
		expect(famJam!.bside!.archivedCount).toBe(1);

		// pending flag = famRound2 (finalized but not in archived_rounds=[famRound1])
		expect(famJam!.pending).not.toBeNull();
		expect(famJam!.pending!.roundId).toBe(famRound2);

		// Other leagues unpublished
		const others = body.filter((l) => l.name !== 'Fam-Jam');
		expect(others.every((l) => l.bside === null)).toBe(true);
		expect(others.every((l) => l.pending === null)).toBe(true);
	});

	it('returns pending=null when all finalized rounds are already archived', async () => {
		const id = insertLeague('all-archived', 'All Archived');
		const seasonId = insertSeason(id);
		const round = insertRound(seasonId, 'Round 1');
		insertFinalizedDraft(round);
		// archived_rounds already includes the finalized round
		insertSite(id, 'all-archived-slug', minimalReadModel('all-archived-slug', [archiveEntry(1)]), [
			round,
		]);

		const res = await GET_leagues(mkEvt());
		const body = (await res.json()) as Array<{ name: string; pending: null }>;
		const league = body.find((l) => l.name === 'All Archived');
		expect(league!.pending).toBeNull();
	});

	// (b) round re-finalized AFTER refreshed_at → pending even though it's in archived_rounds
	it('returns pending when a round is re-finalized after the site was last built', async () => {
		const id = insertLeague('re-finalized', 'Re-Finalized League');
		const seasonId = insertSeason(id);
		const round = insertRound(seasonId, 'New Shit');
		const publishedAt = '2026-06-15T18:07:42.583Z';
		// Round was in archived_rounds at publish time
		insertSite(id, 're-fin-slug', minimalReadModel('re-fin-slug', [archiveEntry(1)]), [round], publishedAt);
		// Then re-finalized AFTER publish
		insertFinalizedDraft(round, '2026-06-15T18:48:17.000Z');

		const res = await GET_leagues(mkEvt());
		const body = (await res.json()) as Array<{ name: string; pending: { roundId: number } | null }>;
		const league = body.find((l) => l.name === 'Re-Finalized League');
		expect(league!.pending).not.toBeNull();
		expect(league!.pending!.roundId).toBe(round);
	});

	// (b) sanity: round finalized BEFORE refreshed_at and already archived → not pending
	it('returns pending=null when archived round finalized_at is before refreshed_at', async () => {
		const id = insertLeague('stale-fin', 'Stale Fin League');
		const seasonId = insertSeason(id);
		const round = insertRound(seasonId, 'Old Round');
		insertFinalizedDraft(round, '2026-06-01T10:00:00.000Z');
		// refreshed_at is AFTER finalized_at; round is archived
		insertSite(id, 'stale-fin-slug', minimalReadModel('stale-fin-slug', [archiveEntry(1)]), [round], '2026-06-15T18:07:42.583Z');

		const res = await GET_leagues(mkEvt());
		const body = (await res.json()) as Array<{ name: string; pending: null }>;
		const league = body.find((l) => l.name === 'Stale Fin League');
		expect(league!.pending).toBeNull();
	});
});

// ── publishSite — archived_rounds only includes finalized rounds (test d) ─────

describe('publishSite — archived_rounds seeds', () => {
	it('archives only rounds that have a finalized digest, not all rounds', async () => {
		const { publishSite } = await import('$lib/dashboard/publish.js');

		const id = insertLeague('pub-test', 'Pub Test League');
		const seasonId = insertSeason(id);
		const finalizedRound = insertRound(seasonId, 'Round 1');
		const unfinalizedRound = insertRound(seasonId, 'Round 2'); // no digest_draft
		insertFinalizedDraft(finalizedRound);
		// unfinalizedRound has no finalized draft

		await publishSite(db, id);

		const row = db
			.prepare('SELECT archived_rounds FROM dashboard_sites WHERE league_id = ?')
			.get(id) as { archived_rounds: string };
		const archived: number[] = JSON.parse(row.archived_rounds);
		expect(archived).toContain(finalizedRound);
		expect(archived).not.toContain(unfinalizedRound);
	});
});

// ── GET /api/content/:leagueId/update-plan ────────────────────────────────────

describe('GET /api/content/:leagueId/update-plan', () => {
	function mkEvt(leagueId: number) {
		return { params: { leagueId: String(leagueId) } } as unknown as Parameters<
			typeof GET_updatePlan
		>[0];
	}

	it('returns sections with entry + 5 recompute rows and pending round details', async () => {
		const id = insertLeague('test-league', 'Test League');
		const seasonId = insertSeason(id);
		const roundId = insertRound(seasonId, 'Chill Vibes');
		insertFinalizedDraft(roundId);
		insertSite(id, 'test-slug', minimalReadModel('test-slug'), []);

		const res = await GET_updatePlan(mkEvt(id));
		expect(res.status).toBe(200);
		const body = await res.json();

		expect(body.pending.roundId).toBe(roundId);
		expect(body.pending.theme).toBe('Chill Vibes');
		expect(body.slug).toBe('test-slug');

		const sections = body.sections as Array<{ id: string; kind: string }>;
		expect(sections.find((s) => s.id === 'entry' && s.kind === 'add')).toBeDefined();
		expect(sections.find((s) => s.id === 'superlatives' && s.kind === 'recompute')).toBeDefined();
		expect(sections.find((s) => s.id === 'stats' && s.kind === 'recompute')).toBeDefined();
		expect(sections.find((s) => s.id === 'fingerprints' && s.kind === 'recompute')).toBeDefined();
		expect(sections.find((s) => s.id === 'moments' && s.kind === 'recompute')).toBeDefined();
		expect(sections.find((s) => s.id === 'overlap' && s.kind === 'recompute')).toBeDefined();
	});

	it('returns 404 for unknown league', async () => {
		await expect(GET_updatePlan(mkEvt(99999))).rejects.toMatchObject({ status: 404 });
	});

	it('returns 400 for invalid leagueId', async () => {
		await expect(
			GET_updatePlan(
				{ params: { leagueId: 'bad' } } as unknown as Parameters<typeof GET_updatePlan>[0],
			),
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 409 when no pending update exists', async () => {
		const id = insertLeague('no-pending', 'No Pending');
		const seasonId = insertSeason(id);
		const roundId = insertRound(seasonId, 'Round 1');
		insertFinalizedDraft(roundId);
		// archived_rounds already includes the round → no pending
		insertSite(id, 'no-pending-slug', minimalReadModel('no-pending-slug', [archiveEntry(1)]), [
			roundId,
		]);

		await expect(GET_updatePlan(mkEvt(id))).rejects.toMatchObject({ status: 409 });
	});
});

// ── POST /api/content/:leagueId/update ───────────────────────────────────────

describe('POST /api/content/:leagueId/update', () => {
	function mkEvt(leagueId: number, body: object) {
		return {
			params: { leagueId: String(leagueId) },
			request: { json: async () => body } as unknown as Request,
		} as unknown as Parameters<typeof POST_update>[0];
	}

	it('persists lock decision, adds round to archived_rounds, keeps slug unchanged', async () => {
		const id = insertLeague('fam-jam', 'Fam-Jam');
		const seasonId = insertSeason(id);
		const roundId = insertRound(seasonId, 'Summer Bops');
		insertFinalizedDraft(roundId);
		const slug = 'fam-jam-stable-slug';
		insertSite(id, slug, minimalReadModel(slug), []);

		const res = await POST_update(
			mkEvt(id, {
				decisions: {
					superlatives: 'lock',
					fingerprints: 'hold',
					stats: 'hold',
					moments: 'hold',
					overlap: 'hold',
				},
				steer: {},
				announce: 'card',
			}),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.slug).toBe(slug);
		expect(body.archivedRoundId).toBe(roundId);

		// archived_rounds in DB must now contain the round
		const siteRow = db
			.prepare('SELECT archived_rounds FROM dashboard_sites WHERE league_id = ?')
			.get(id) as { archived_rounds: string };
		const archived: number[] = JSON.parse(siteRow.archived_rounds);
		expect(archived).toContain(roundId);

		// dashboard_section_state must have decision='lock' for superlatives
		const stateRow = db
			.prepare(
				"SELECT decision FROM dashboard_section_state WHERE league_id = ? AND section = 'superlatives'",
			)
			.get(id) as { decision: string } | undefined;
		expect(stateRow).toBeDefined();
		expect(stateRow!.decision).toBe('lock');
	});

	it('slug is unchanged on second update (same-slug guarantee)', async () => {
		const id = insertLeague('stable', 'Stable League');
		const seasonId = insertSeason(id);
		const round1 = insertRound(seasonId, 'Round 1');
		const round2 = insertRound(seasonId, 'Round 2');
		insertFinalizedDraft(round1);
		insertFinalizedDraft(round2);
		const slug = 'stable-forever-slug';
		// round1 already archived; round2 is the pending one
		insertSite(
			id,
			slug,
			minimalReadModel(slug, [archiveEntry(1)]),
			[round1],
		);

		const res = await POST_update(
			mkEvt(id, {
				decisions: { superlatives: 'hold', fingerprints: 'hold', stats: 'hold', moments: 'hold', overlap: 'hold' },
				steer: {},
				announce: 'silent',
			}),
		);
		const body = await res.json();
		expect(body.slug).toBe(slug);

		// Confirm the site row still has the same slug
		const siteRow = db
			.prepare('SELECT slug FROM dashboard_sites WHERE league_id = ?')
			.get(id) as { slug: string };
		expect(siteRow.slug).toBe(slug);
	});

	it('dashboard_section_state persists lock across calls', async () => {
		const id = insertLeague('lock-test', 'Lock Test');
		const seasonId = insertSeason(id);
		const roundId = insertRound(seasonId, 'Locked Round');
		insertFinalizedDraft(roundId);
		insertSite(id, 'lock-slug', minimalReadModel('lock-slug'), []);

		await POST_update(
			mkEvt(id, {
				decisions: { superlatives: 'lock', fingerprints: 'hold', stats: 'hold', moments: 'hold', overlap: 'hold' },
				steer: {},
				announce: 'silent',
			}),
		);

		const rows = db
			.prepare('SELECT section, decision FROM dashboard_section_state WHERE league_id = ?')
			.all(id) as { section: string; decision: string }[];
		const superlativesRow = rows.find((r) => r.section === 'superlatives');
		expect(superlativesRow?.decision).toBe('lock');
	});

	it('returns 409 when no pending update exists', async () => {
		const id = insertLeague('up-to-date', 'Up To Date');
		const seasonId = insertSeason(id);
		const roundId = insertRound(seasonId, 'Round 1');
		insertFinalizedDraft(roundId);
		insertSite(id, 'utd-slug', minimalReadModel('utd-slug', [archiveEntry(1)]), [roundId]);

		await expect(
			POST_update(
				mkEvt(id, { decisions: {}, steer: {}, announce: 'card' }),
			),
		).rejects.toMatchObject({ status: 409 });
	});

	it('returns 404 for unpublished league', async () => {
		const id = insertLeague('no-site', 'No Site');
		const seasonId = insertSeason(id);
		const roundId = insertRound(seasonId, 'Round 1');
		insertFinalizedDraft(roundId);
		// No insertSite → no dashboard_sites row

		await expect(
			POST_update(mkEvt(id, { decisions: {}, steer: {}, announce: 'card' })),
		).rejects.toMatchObject({ status: 404 });
	});

	// (c) after update, refreshed_at advances → re-finalized round is no longer pending
	it('clears pending after update: refreshed_at > finalized_at, round in archived_rounds', async () => {
		const id = insertLeague('clears-after-update', 'Clears After Update');
		const seasonId = insertSeason(id);
		const round = insertRound(seasonId, 'Clearable Round');
		const publishedAt = '2026-06-15T18:07:42.583Z';
		// Round was archived at publish but then re-finalized after publish
		insertSite(id, 'clear-slug', minimalReadModel('clear-slug', [archiveEntry(1)]), [round], publishedAt);
		insertFinalizedDraft(round, '2026-06-15T18:48:17.000Z');

		// Confirm it starts as pending in the leagues list
		const before = (await (await GET_leagues({} as Parameters<typeof GET_leagues>[0])).json()) as
			Array<{ name: string; pending: { roundId: number } | null }>;
		expect(before.find((l) => l.name === 'Clears After Update')!.pending).not.toBeNull();

		// Perform the update
		await POST_update(
			mkEvt(id, {
				decisions: { superlatives: 'hold', fingerprints: 'hold', stats: 'hold', moments: 'hold', overlap: 'hold' },
				steer: {},
				announce: 'silent',
			}),
		);

		// After update, refreshed_at is now > finalized_at and round remains in archived_rounds
		const after = (await (await GET_leagues({} as Parameters<typeof GET_leagues>[0])).json()) as
			Array<{ name: string; pending: null }>;
		expect(after.find((l) => l.name === 'Clears After Update')!.pending).toBeNull();
	});
});

// ── POST /api/content/:leagueId/reshare ──────────────────────────────────────

describe('POST /api/content/:leagueId/reshare', () => {
	function mkEvt(leagueId: number, body: object) {
		return {
			params: { leagueId: String(leagueId) },
			request: { json: async () => body } as unknown as Request,
		} as unknown as Parameters<typeof POST_reshare>[0];
	}

	it('card mode returns headline + cardText containing the slug URL', async () => {
		const id = insertLeague('reshare-league', 'Reshare League');
		const slug = 'reshare-slug';
		insertSite(id, slug, minimalReadModel(slug, [archiveEntry(1)]), []);

		const res = await POST_reshare(mkEvt(id, { mode: 'card' }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.mode).toBe('card');
		expect(body.cardText).toContain(slug);
		expect(body.headline).toBeTruthy();
	});

	it('silent mode returns ok with url and no cardText', async () => {
		const id = insertLeague('silent-league', 'Silent League');
		const slug = 'silent-slug';
		insertSite(id, slug, minimalReadModel(slug, [archiveEntry(1)]), []);

		const res = await POST_reshare(mkEvt(id, { mode: 'silent' }));
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.mode).toBe('silent');
		expect(body.url).toContain(slug);
		expect(body.cardText).toBeUndefined();
	});

	it('link mode returns linkText without cardText', async () => {
		const id = insertLeague('link-league', 'Link League');
		const slug = 'link-slug';
		insertSite(id, slug, minimalReadModel(slug, [archiveEntry(1)]), []);

		const res = await POST_reshare(mkEvt(id, { mode: 'link' }));
		const body = await res.json();
		expect(body.mode).toBe('link');
		expect(body.linkText).toContain(slug);
		expect(body.cardText).toBeUndefined();
	});

	it('returns 404 for unpublished league', async () => {
		const id = insertLeague('no-site-reshare', 'No Site Reshare');
		await expect(POST_reshare(mkEvt(id, { mode: 'card' }))).rejects.toMatchObject({ status: 404 });
	});
});
