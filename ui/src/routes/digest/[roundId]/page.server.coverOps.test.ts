// The 1.0 digest page load: Cover Factory operator keys (podium _coverNotes / _coverProjects) reach
// the operator view untouched and are stripped from share (?share=1) and export (?export=1) renders,
// in both the parsed `content` and the raw `content_json` that is spread into the page data.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openLeagueDb } from '$lib/db/client.js';
import { seedLeagues, upsertSeason } from '$lib/db/leagues.js';
import { upsertRound } from '$lib/db/rounds.js';
import { getSectionsForDraft } from '$lib/digest/llm.js';

let db: Database.Database;
vi.mock('$lib/db/client.js', async (orig) => ({ ...(await orig<typeof import('$lib/db/client.js')>()), getDb: () => db }));
const { load } = await import('./+page.server.js');

const PODIUM = {
	title: 'Podium',
	items: [{ rank: 1, title: 'A', artist: 'X', coverUrl: '/api/cover-factory/media/exports/1-ab.gif' }],
	_coverNotes: { '1': 'operator note' },
	_coverProjects: { '1': 7 },
};
const OTHER = { title: 'Villain', body: 'b' };
let roundId: number;

beforeEach(() => {
	db = openLeagueDb(':memory:');
	seedLeagues(db);
	const leagueId = (db.prepare(`SELECT id FROM leagues WHERE slug = 'second-best'`).get() as { id: number }).id;
	roundId = upsertRound(db, upsertSeason(db, leagueId, 1, 'active'), { mlRoundId: 'r', name: 'R', description: '', spotifyPlaylistUrl: '', createdAt: '2026-01-01T00:00:00Z' });
	db.prepare(`INSERT INTO digest_drafts (id, round_id, rel_context, prep_checks, stats_content_json, generated_at) VALUES ('d', ?, '', '', '{}', '2026-11-04T00:00:00Z')`).run(roundId);
	db.prepare(`INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json) VALUES ('d-p', 'd', 'podium', 0, 'default', ?), ('d-v', 'd', 'villain', 1, 'default', ?)`)
		.run(JSON.stringify(PODIUM), JSON.stringify(OTHER));
});

type Section = { id: string; content: unknown; content_json: string };
async function sections(qs: string): Promise<Section[]> {
	const fetch = (async () => new Response('{}', { status: 404 })) as typeof globalThis.fetch;
	const out = (await load({ params: { roundId: String(roundId) }, fetch, url: new URL(`http://x/digest/${roundId}${qs}`) } as never)) as { sections: Section[] };
	return out.sections;
}

describe('digest page load: cover operator keys', () => {
	it('operator view: every section row is exactly the stored row plus its parsed content', async () => {
		const rows = getSectionsForDraft(db, 'd');
		const got = await sections('');
		for (const row of rows) {
			const s = got.find((x) => x.id === row.id)!;
			expect(s).toMatchObject(row); // same fields, same content_json string
			expect(s.content).toEqual(JSON.parse(row.content_json));
		}
		expect((got.find((s) => s.id === 'd-p')!.content as typeof PODIUM)._coverNotes).toEqual({ '1': 'operator note' });
	});
	for (const qs of ['?share=1', '?export=1']) {
		it(`${qs}: the podium loses _cover* in content and content_json; other rows untouched`, async () => {
			const got = await sections(qs);
			const p = got.find((s) => s.id === 'd-p')!;
			const { _coverNotes, _coverProjects, ...rest } = PODIUM;
			void _coverNotes; void _coverProjects;
			expect(p.content).toEqual(rest);
			expect(JSON.parse(p.content_json)).toEqual(rest);
			expect(JSON.stringify(p)).not.toMatch(/_cover|operator note/);
			const v = got.find((s) => s.id === 'd-v')!;
			expect(v.content_json).toBe(JSON.stringify(OTHER));
		});
	}
});
