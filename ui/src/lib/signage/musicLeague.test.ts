import { it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLeagueDb } from '../db/client.js';
import { buildSignage } from './musicLeague.js';

const NOW = Date.parse('2026-11-11T20:00:00Z');
let db: Database.Database;

function league(slug: string, name: string): number {
  return Number(db.prepare('INSERT INTO leagues (slug, name) VALUES (?, ?)').run(slug, name).lastInsertRowid);
}
function season(leagueId: number, n: number, status = 'active', managedBy: string | null = null): number {
  return Number(db.prepare('INSERT INTO seasons (league_id, season_number, status, managed_by) VALUES (?,?,?,?)')
    .run(leagueId, n, status, managedBy).lastInsertRowid);
}
function round(seasonId: number, key: string, o: {
  name: string; desc?: string; num?: number; sub?: string | null; vote?: string | null; phase?: string | null; managedBy?: string | null;
}): number {
  return Number(db.prepare(`INSERT INTO rounds (season_id, ml_round_id, name, description, submission_deadline, voting_deadline,
      created_at, phase, round_number, managed_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(seasonId, key, o.name, o.desc ?? 'A theme', o.sub ?? null, o.vote ?? null, '2026-01-01T00:00:00Z',
      o.phase ?? null, o.num ?? null, o.managedBy ?? null).lastInsertRowid);
}
function player(name: string): number {
  return Number(db.prepare('INSERT INTO players (name) VALUES (?)').run(name).lastInsertRowid);
}
function competitor(name: string, playerId: number | null): number {
  return Number(db.prepare('INSERT INTO competitors (ml_competitor_id, name, player_id) VALUES (?,?,?)')
    .run(`c-${name}`, name, playerId).lastInsertRowid);
}
function setPeople(map: Record<string, string>): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('signage_people', ?)").run(JSON.stringify(map));
}
function join_(seasonId: number, playerId: number): void {
  db.prepare('INSERT INTO season_players (season_id, player_id) VALUES (?,?)').run(seasonId, playerId);
}

beforeEach(() => { db = openLeagueDb(':memory:'); });

it('only active seasons are listed, rounds ordered by number', () => {
  const l = league('test-league', 'Test League');
  const s = season(l, 2);
  season(l, 1, 'complete');
  round(s, 'r2', { name: 'Second', num: 2, sub: '2026-11-01T00:00:00Z', vote: '2026-11-20T00:00:00Z' });
  round(s, 'r1', { name: 'First', num: 1, sub: '2026-10-01T00:00:00Z', vote: '2026-10-10T00:00:00Z' });
  round(s, 'r3', { name: 'Third', num: 3 });
  const out = buildSignage(db, NOW);
  expect(out.generatedAt).toBe('2026-11-11T20:00:00.000Z');
  expect(out.seasons).toHaveLength(1);
  const [se] = out.seasons;
  expect(se.league).toEqual({ slug: 'test-league', name: 'Test League' });
  expect(se.season).toBe(2);
  expect(se.roundCount).toBe(3);
  expect(se.rounds.map(r => r.number)).toEqual([1, 2, 3]);
  expect(se.rounds.map(r => r.phase)).toEqual(['complete', 'voting', 'submission']);
  expect(se.rounds[1]).toMatchObject({ title: 'Second', theme: 'A theme', submitBy: '2026-11-01T00:00:00Z', voteBy: '2026-11-20T00:00:00Z' });
  expect(se.rounds[2].submitBy).toBeNull();
});

it('members and person come from signage_people, unmapped players are null', () => {
  const l = league('test-league', 'Test League');
  const s = season(l, 1);
  const r1 = round(s, 'r1', { name: 'One', num: 1, sub: '2026-10-01T00:00:00Z', vote: '2026-10-10T00:00:00Z' });
  const pa = player('Player A'), pb = player('Player B'), pc = player('Player C'), pd = player('Player D');
  [pa, pb, pc].forEach(p => join_(s, p));
  setPeople({ [pa]: 'matt', [pb]: 'mara', [pd]: 'ghost' }); // pd is mapped but not in the season
  const ca = competitor('Player A', pa), cc = competitor('Player C', pc);
  competitor('Player B', pb);
  const ins = db.prepare(`INSERT INTO season_standings (season_id, round_id, competitor_id, name, prior_total, round_points, current_total, rank, prev_rank)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run(s, r1, ca, 'Player A', 0, 10, 10, 1, null);
  ins.run(s, r1, cc, 'Player C', 0, 5, 5, 2, null);
  const [se] = buildSignage(db, NOW).seasons;
  expect(se.members).toEqual(['matt', 'mara']);
  expect(se.standings!.rows.map(r => r.person)).toEqual(['matt', null]);
});

it('a survey round before reveal.at is revealed: false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'signage-survey-'));
  try {
    const w = (f: string, v: unknown) => writeFileSync(join(dir, f), JSON.stringify(v));
    w('second-best-ml-link.json', { leagueId: 'L1' });
    w('second-best-draft-season.json', {
      season: 3,
      rounds: [
        { position: 1, reveal: { at: '2026-11-01T00:00:00Z' } },
        { position: 2, reveal: { at: '2026-12-01T00:00:00Z' } },
      ],
    });
    w('second-best-ml-sync-state.json', { lastRounds: [
      { id: 'a', league_id: 'L1', number: 1, name: 'Open Theme' },
      { id: 'b', league_id: 'L1', number: 2, name: 'Teaser Theme' },
    ] });
    const l = league('second-best', 'Test Survey League');
    const s = season(l, 3, 'active', 'survey');
    round(s, 'a', { name: 'Open Theme', num: 1, managedBy: 'survey' });
    round(s, 'b', { name: 'Teaser Theme', num: 2, managedBy: 'survey' });
    const [se] = buildSignage(db, NOW, { surveyDir: dir }).seasons;
    expect(se.rounds.map(r => r.revealed)).toEqual([true, false]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('a survey round is revealed: false when survey data is unavailable or the round is absent', () => {
  const l = league('second-best', 'Test Survey League');
  const s = season(l, 3, 'active', 'survey');
  round(s, 'a', { name: 'Real Title', num: 1, managedBy: 'survey' });
  expect(buildSignage(db, NOW, { surveyDir: '/nonexistent-dir' }).seasons[0].rounds[0].revealed).toBe(false);
  const dir = mkdtempSync(join(tmpdir(), 'signage-survey-'));
  try {
    const w = (f: string, v: unknown) => writeFileSync(join(dir, f), JSON.stringify(v));
    w('second-best-ml-link.json', { leagueId: 'L1' });
    w('second-best-draft-season.json', { season: 3, rounds: [{ position: 1 }] });
    w('second-best-ml-sync-state.json', { lastRounds: [{ id: 'x', league_id: 'L1', number: 1, name: 'Other' }] });
    round(s, 'b', { name: 'Not In Survey', num: 2, managedBy: 'survey' });
    const rs = buildSignage(db, NOW, { surveyDir: dir }).seasons[0].rounds;
    expect(rs.map(r => r.revealed)).toEqual([true, false]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('theme has links and emails stripped', () => {
  const l = league('test-league', 'Test League');
  round(season(l, 1), 'a', { name: 'One', num: 1,
    desc: 'Songs  about   rain https://open.spotify.com/playlist/abc and open.spotify.com/x mail me@example.test now' });
  const body = buildSignage(db, NOW);
  const text = JSON.stringify(body);
  expect(text).not.toContain('spotify');
  expect(text).not.toContain('@');
  expect(body.seasons[0].rounds[0].theme).toBe('Songs about rain and mail now');
});

it('a non-survey round titled TBD is revealed: false', () => {
  const l = league('test-league', 'Test League');
  const s = season(l, 1);
  round(s, 'a', { name: 'Real', num: 1 });
  round(s, 'b', { name: 'TBD', num: 2 });
  round(s, 'c', { name: 'No Description', num: 3, desc: '' });
  const [se] = buildSignage(db, NOW).seasons;
  expect(se.rounds.map(r => r.revealed)).toEqual([true, false, false]);
});

it('submitted maps submission_events names case-insensitively and ignores unknown names', () => {
  const l = league('test-league', 'Test League');
  const s = season(l, 1);
  const r1 = round(s, 'r1', { name: 'One', num: 1 });
  const r2 = round(s, 'r2', { name: 'Two', num: 2 });
  const pa = player('Player A'), pb = player('Player B');
  [pa, pb].forEach(p => join_(s, p));
  setPeople({ [pa]: 'matt', [pb]: 'mara' });
  competitor('Player A', pa);
  competitor('Player B', pb);
  competitor('Player Z', null);
  const ev = db.prepare('INSERT INTO submission_events (message_id, round_id, submitter_name, occurred_at) VALUES (?,?,?,?)');
  ev.run('m1', r1, 'PLAYER b', '2026-11-02T00:00:00Z');
  ev.run('m2', r1, 'Player B', '2026-11-03T00:00:00Z'); // duplicate
  ev.run('m3', r1, 'Player Z', '2026-11-03T00:00:00Z'); // unmapped player
  ev.run('m4', r1, 'Nobody Known', '2026-11-03T00:00:00Z'); // unknown name
  ev.run('m5', r2, 'player a', '2026-11-04T00:00:00Z');
  const [se] = buildSignage(db, NOW).seasons;
  expect(se.rounds[0].submitted).toEqual(['mara']);
  expect(se.rounds[1].submitted).toEqual(['matt']);
});

it('voted is [] when vote_events does not exist', () => {
  const l = league('test-league', 'Test League');
  round(season(l, 1), 'r1', { name: 'One', num: 1 });
  expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='vote_events'").get()).toBeUndefined();
  expect(buildSignage(db, NOW).seasons[0].rounds[0].voted).toEqual([]);
});

it('voted reads vote_events when the table exists', () => {
  const l = league('test-league', 'Test League');
  const s = season(l, 1);
  const r1 = round(s, 'r1', { name: 'One', num: 1 });
  const pa = player('Player A');
  join_(s, pa);
  setPeople({ [pa]: 'mara' });
  competitor('Player A', pa);
  db.exec(`CREATE TABLE vote_events (message_id TEXT PRIMARY KEY, round_id INTEGER, voter_name TEXT NOT NULL, occurred_at TEXT NOT NULL)`);
  db.prepare('INSERT INTO vote_events VALUES (?,?,?,?)').run('v1', r1, 'player a', '2026-11-02T00:00:00Z');
  expect(buildSignage(db, NOW).seasons[0].rounds[0].voted).toEqual(['mara']);
});

it('standings is the latest snapshot, null before round 1 ends', () => {
  const l = league('test-league', 'Test League');
  const s = season(l, 1);
  const r1 = round(s, 'r1', { name: 'One', num: 1 });
  const r2 = round(s, 'r2', { name: 'Two', num: 2 });
  expect(buildSignage(db, NOW).seasons[0].standings).toBeNull();
  const c = competitor('Player A', null);
  const ins = db.prepare(`INSERT INTO season_standings (season_id, round_id, competitor_id, name, prior_total, round_points, current_total, rank, prev_rank)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run(s, r1, c, 'Player A', 0, 10, 10, 2, null);
  expect(buildSignage(db, NOW).seasons[0].standings).toMatchObject({ afterRound: 1 });
  ins.run(s, r2, c, 'Player A', 10, 7, 17, 1, 2);
  expect(buildSignage(db, NOW).seasons[0].standings).toEqual({
    afterRound: 2,
    rows: [{ rank: 1, prevRank: 2, name: 'Player A', total: 17, roundPoints: 7, person: null }],
  });
});

it('shortlist lists only songs assigned to rounds that are not complete', () => {
  const l = league('test-league', 'Test League');
  const s = season(l, 1);
  const done = round(s, 'r1', { name: 'One', num: 1, sub: '2026-10-01T00:00:00Z', vote: '2026-10-10T00:00:00Z' });
  const open = round(s, 'r2', { name: 'Two', num: 2, sub: '2026-11-20T00:00:00Z', vote: '2026-11-30T00:00:00Z' });
  const song = db.prepare(`INSERT INTO shortlist_songs (id, spotify_uri, artist, title, rating_discovery, rating_theme_fit, rating_nostalgia,
    rating_personal, rating_quality, rating_replayability) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  song.run('s1', 'uri:1', 'Artist One', 'Song One', 4, 4, 4, 4, 4, 5);
  song.run('s2', 'uri:2', 'Artist Two', 'Song Two', 0, 0, 0, 0, 0, 0);
  song.run('s3', 'uri:3', 'Artist Three', 'Song Three', 5, 5, 5, 5, 5, 5);
  const asg = db.prepare('INSERT INTO shortlist_assignments (shortlist_song_id, round_id) VALUES (?,?)');
  asg.run('s1', open); asg.run('s2', open); asg.run('s3', done);
  const { shortlist } = buildSignage(db, NOW).seasons[0];
  expect(shortlist).toEqual([
    { round: 2, title: 'Song One', artist: 'Artist One', rating: 4 },
    { round: 2, title: 'Song Two', artist: 'Artist Two', rating: null },
  ]);
});

it('no email, handle beyond display name, or Spotify URL appears in the JSON', () => {
  const l = league('test-league', 'Test League');
  const s = season(l, 1);
  const r1 = round(s, 'r1', { name: 'One', num: 1, sub: '2026-10-01T00:00:00Z', vote: '2026-10-10T00:00:00Z' });
  const pa = player('Player A');
  join_(s, pa);
  setPeople({ [pa]: 'matt' });
  const c = competitor('Player A', pa);
  db.prepare("UPDATE rounds SET spotify_playlist_url='https://open.spotify.com/playlist/x' WHERE id=?").run(r1);
  db.prepare(`INSERT INTO season_standings (season_id, round_id, competitor_id, name, current_total, rank) VALUES (?,?,?,?,?,?)`)
    .run(s, r1, c, 'Player A', 3, 1);
  db.prepare(`INSERT INTO shortlist_songs (id, spotify_uri, artist, title) VALUES ('s1','spotify:track:abc','Artist One','Song One')`).run();
  db.prepare('INSERT INTO shortlist_assignments (shortlist_song_id, round_id) VALUES (?,?)').run('s1', r1);
  db.prepare('INSERT INTO submission_events (message_id, round_id, submitter_name, occurred_at) VALUES (?,?,?,?)')
    .run('id@mail.example', r1, 'Player A', '2026-11-02T00:00:00Z');
  const text = JSON.stringify(buildSignage(db, NOW));
  expect(text).not.toContain('@');
  expect(text).not.toContain('spotify.com');
  expect(text).not.toContain('spotify:');
  expect(text).not.toMatch(/ml_?handle|ml_competitor_id|mlCompetitorId/i);
});
