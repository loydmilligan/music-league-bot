import { it, expect } from 'vitest';
import { openLeagueDb } from '../db/client.js';
import { seedLeagues } from '../db/leagues.js';
import { readSurveyLeague, LEAGUE_DEFS } from './parse.js';
import { applySurveyLeague } from './apply.js';
import { writeSurveyDir, NOW, LEAGUE_ID } from './fixture.js';

const SB = LEAGUE_DEFS.find(d => d.slug === 'second-best')!;
const ISO = new Date(NOW).toISOString();

function setup() {
  const db = openLeagueDb(':memory:');
  seedLeagues(db);
  const matt = Number(db.prepare("INSERT INTO players (name) VALUES ('Matt Mariani')").run().lastInsertRowid);
  const sarah = Number(db.prepare("INSERT INTO players (name) VALUES ('Sarah Black')").run().lastInsertRowid);
  return { db, matt, sarah };
}

function parsed(now = NOW) {
  const res = readSurveyLeague(writeSurveyDir(), SB, now);
  if (!res.ok) throw new Error(res.error);
  return res.league;
}

const rounds = (db: any) => db.prepare('SELECT * FROM rounds ORDER BY round_number').all() as any[];

it('creates the season and rounds, marked survey-managed', () => {
  const { db, matt } = setup();
  const res = applySurveyLeague(db, parsed(), ISO);
  expect(res.inserted).toBe(4);
  const season = db.prepare('SELECT * FROM seasons WHERE id=?').get(res.seasonId) as any;
  expect(season).toMatchObject({ season_number: 3, status: 'active', source_competition_id: LEAGUE_ID, managed_by: 'survey' });
  const rs = rounds(db);
  expect(rs.map(r => r.name)).toEqual(['I Heard They Suck Live...', 'I Bought the Soundtrack', 'Poll Position', 'Unknown credit']);
  expect(rs.every(r => r.managed_by === 'survey')).toBe(true);
  expect(rs[0]).toMatchObject({ ml_round_id: 'ml1', round_number: 1, submission_deadline: '2026-10-07T07:00:00Z',
    voting_deadline: '2026-10-11T07:00:00Z', theme_submitted_by: matt, comment_level: 'required',
    comment_visibility: 'after-voting', comment_prompt: 'Tell us about the show' });
});

it('first credited name that matches a player wins', () => {
  const { db, sarah } = setup();
  applySurveyLeague(db, parsed(), ISO);
  expect(rounds(db)[1].theme_submitted_by).toBe(sarah);
});

it('unrevealed round gets no credit or comment rule', () => {
  const { db } = setup();
  applySurveyLeague(db, parsed(), ISO);
  expect(rounds(db)[2]).toMatchObject({ name: 'Poll Position', theme_submitted_by: null, comment_level: null, comment_prompt: null });
});

it('unmatched credit leaves submitter empty and warns', () => {
  const { db } = setup();
  const res = applySurveyLeague(db, parsed(), ISO);
  expect(rounds(db)[3].theme_submitted_by).toBeNull();
  expect(res.warnings).toEqual(['round 4: no bot player named Nobody Known']);
});

it('matches credit through player_identities with odd whitespace', () => {
  const { db } = setup();
  const pid = Number(db.prepare("INSERT INTO players (name) VALUES ('N. Known')").run().lastInsertRowid);
  db.prepare("INSERT INTO player_identities (player_id, league_id, identity_type, identifier) VALUES (?, NULL, 'whatsapp', ?)")
    .run(pid, 'Nobody Known');
  const res = applySurveyLeague(db, parsed(), ISO);
  expect(rounds(db)[3].theme_submitted_by).toBe(pid);
  expect(res.warnings).toEqual([]);
});

it('is idempotent: a second run inserts and changes nothing', () => {
  const { db } = setup();
  applySurveyLeague(db, parsed(), ISO);
  const before = rounds(db);
  const res = applySurveyLeague(db, parsed(), ISO);
  expect(res).toMatchObject({ inserted: 0, updated: 0 });
  expect(rounds(db)).toEqual(before);
});

it('after the reveal the real title, credit and rule land', () => {
  const { db, matt } = setup();
  applySurveyLeague(db, parsed(), ISO);
  const later = parsed(Date.parse('2026-12-01T00:00:00Z'));
  later.rounds[2].name = 'Eine kleine Nachtmusik'; // worker re-synced ML after reveal
  const res = applySurveyLeague(db, later, ISO);
  expect(res.updated).toBe(1);
  expect(rounds(db)[2]).toMatchObject({ name: 'Eine kleine Nachtmusik', theme_submitted_by: matt, comment_level: 'suggested' });
});

it('adopts an existing hand-made season without changing its status', () => {
  const { db } = setup();
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='second-best'").get() as any).id;
  const sid = Number(db.prepare("INSERT INTO seasons (league_id, season_number, status) VALUES (?, 3, 'complete')").run(leagueId).lastInsertRowid);
  const res = applySurveyLeague(db, parsed(), ISO);
  expect(res.seasonId).toBe(sid);
  expect(db.prepare('SELECT status, managed_by FROM seasons WHERE id=?').get(sid)).toEqual({ status: 'complete', managed_by: 'survey' });
});

it('runSurveySync records per-league status, including a missing league', async () => {
  const { runSurveySync, getSurveySyncStatus } = await import('./runner.js');
  const { db } = setup();
  const status = runSurveySync(db, writeSurveyDir(), NOW);
  expect(status['second-best']).toMatchObject({ ok: true, seasonNumber: 3, rounds: 4, inserted: 4 });
  expect(status['boarz-ii-men'].ok).toBe(false);
  expect(getSurveySyncStatus(db)).toEqual(status);
});
