import { it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSurveyLeague, LEAGUE_DEFS } from './parse.js';
import { writeSurveyDir, NOW, LEAGUE_ID, SECRET_TITLE } from './fixture.js';

const SB = LEAGUE_DEFS.find(d => d.slug === 'second-best')!;

function ok(dir: string, now = NOW) {
  const res = readSurveyLeague(dir, SB, now);
  if (!res.ok) throw new Error(res.error);
  return res.league;
}

it('reads season, league link and ML snapshot rounds', () => {
  const l = ok(writeSurveyDir());
  expect(l.mlLeagueId).toBe(LEAGUE_ID);
  expect(l.seasonNumber).toBe(3);
  expect(l.rounds.map(r => [r.mlRoundId, r.number])).toEqual([['ml1', 1], ['ml2', 2], ['ml3', 3], ['ml4', 4]]);
  expect(l.rounds[0].submissionDeadline).toBe('2026-10-07T07:00:00Z');
  expect(l.rounds[0].votingDeadline).toBe('2026-10-11T07:00:00Z');
  expect(l.warnings).toEqual([]);
});

it('unrevealed round keeps the ML teaser and leaks nothing from the survey', () => {
  const l = ok(writeSurveyDir());
  const r3 = l.rounds[2];
  expect(r3.name).toBe('Poll Position');
  expect(r3.revealed).toBe(false);
  expect(r3.credits).toEqual([]);
  expect(r3.comment).toBeNull();
  expect(JSON.stringify(l)).not.toContain(SECRET_TITLE);
  expect(JSON.stringify(l)).not.toContain('secret');
});

it('revealed round carries credit and comment rule', () => {
  const r1 = ok(writeSurveyDir()).rounds[0];
  expect(r1.revealed).toBe(true);
  expect(r1.credits).toEqual(['Matt Mariani']);
  expect(r1.comment).toEqual({ level: 'required', visibility: 'after-voting', prompt: 'Tell us about the show' });
});

it('multi-credit keeps order, de-dupes and drops mlbot (Admins)', () => {
  const r2 = ok(writeSurveyDir()).rounds[1];
  expect(r2.credits).toEqual(['Sarah Black', 'Matt Mariani']);
  expect(r2.comment).toEqual({ level: 'none', visibility: null, prompt: null });
});

it('prefers the published season over the draft', () => {
  const l = ok(writeSurveyDir({ published: true }));
  expect(l.rounds[0].credits).toEqual(['Matt Mariani']);
});

it('the round becomes revealed once its reveal time passes', () => {
  const r3 = ok(writeSurveyDir(), Date.parse('2026-12-01T00:00:00Z')).rounds[2];
  expect(r3.revealed).toBe(true);
  expect(r3.credits).toEqual(['Matt Mariani']);
  expect(r3.comment?.prompt).toBe('secret prompt');
});

it('rejects a snapshot taken for a different league', () => {
  const res = readSurveyLeague(writeSurveyDir({ leagueIdInSnapshot: 'other' }), SB, NOW);
  expect(res.ok).toBe(false);
});

it('warns when the survey worker heartbeat is stale', () => {
  const l = ok(writeSurveyDir({ heartbeatAt: '2026-10-01T00:00:00Z' }));
  expect(l.warnings.join(' ')).toMatch(/may be down/);
});

it('missing files produce an error, not a throw', () => {
  const res = readSurveyLeague(mkdtempSync(join(tmpdir(), 'empty-')), SB, NOW);
  expect(res.ok).toBe(false);
});

it('strips survey admin links from text it reads from the survey', async () => {
  const { withoutAdminLinks } = await import('./parse.js');
  expect(withoutAdminLinks('See https://mlsurvey.mattmariani.com/boarz/season-2/admin/ for rules'))
    .toBe('See for rules');
  expect(withoutAdminLinks('Link the /second-best/season-3/admin?x=1 page')).toBe('Link the page');
  expect(withoutAdminLinks('Post a YouTube link')).toBe('Post a YouTube link');
});
