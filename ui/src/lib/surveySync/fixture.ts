// Test-only: writes a synthetic survey data dir in the real file layout.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { themeId } from './parse.js';

export const LEAGUE_ID = '32c57c48ed2f40808c01b8967291b06a';
export const NOW = Date.parse('2026-10-05T12:00:00Z');
export const SECRET_TITLE = 'Eine kleine Nachtmusik';

export function writeSurveyDir(opts: { leagueIdInSnapshot?: string; heartbeatAt?: string; published?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'survey-'));
  const p = 'second-best-';
  const subs = [
    { id: 's1', voterName: 'Matt Mariani', themes: [{ title: 'Live at the Gate', description: 'saw it live' }] },
    { id: 's2', voterName: 'Sarah Black', themes: [{ title: '', description: 'soundtracks' }] },
    { id: 's3', voterName: 'mlbot', themes: [{ title: 'Admin pick', description: 'x' }] },
    { id: 's4', voterName: 'Nobody Known', themes: [{ title: 'Mystery', description: 'y' }] },
  ];
  const tid = (i: number) => themeId(subs[i], subs[i].themes[0], 0);
  const rounds = [
    { id: 'a', position: 1, title: 'I Heard They Suck Live...', description: 'live',
      commentRequirement: { level: 'required', prompt: 'Tell us about the show', visibility: 'after-voting' },
      links: [{ themeId: tid(0) }], reveal: { at: '2026-10-03T00:00:00Z', teaserTitle: 'Wait for it!' } },
    { id: 'b', position: 2, title: 'I Bought the Soundtrack', description: 'sound',
      links: [{ themeId: tid(1) }, { themeId: tid(0) }, { themeId: tid(2) }], reveal: null },
    { id: 'c', position: 3, title: SECRET_TITLE, description: 'secret desc',
      commentRequirement: { level: 'suggested', prompt: 'secret prompt' },
      links: [{ themeId: tid(0) }], reveal: { at: '2026-11-30T04:18:00Z', teaserTitle: 'Poll Position' } },
    { id: 'd', position: 4, title: 'Unknown credit', description: 'u', links: [{ themeId: tid(3) }, { themeId: tid(2) }], reveal: null },
  ];
  const lid = opts.leagueIdInSnapshot ?? LEAGUE_ID;
  const snap = [
    { league_id: lid, id: 'ml1', number: 1, name: 'I Heard They Suck Live...', description: 'live\n\nTheme by Matt Mariani',
      submissions_due_utc: '2026-10-07T07:00:00Z', votes_due_utc: '2026-10-11T07:00:00Z' },
    { league_id: lid, id: 'ml2', number: 2, name: 'I Bought the Soundtrack', description: 'sound',
      submissions_due_utc: '2026-10-14T07:00:00Z', votes_due_utc: '2026-10-18T07:00:00Z' },
    { league_id: lid, id: 'ml3', number: 3, name: 'Poll Position', description: 'teaser desc',
      submissions_due_utc: '2026-10-21T07:00:00Z', votes_due_utc: '2026-10-25T07:00:00Z' },
    { league_id: lid, id: 'ml4', number: 4, name: 'Unknown credit', description: 'u',
      submissions_due_utc: '2026-10-28T07:00:00Z', votes_due_utc: '2026-11-01T07:00:00Z' },
  ];
  const w = (name: string, v: unknown) => writeFileSync(join(dir, name), JSON.stringify(v));
  w(p + 'ml-link.json', { leagueId: LEAGUE_ID, schedule: {} });
  w(p + 'draft-season.json', { league: 'SECOND BEST & FRIENDS', season: 3, rounds: opts.published ? [] : rounds });
  if (opts.published) w(p + 'published-season.json', { rounds });
  w(p + 'ml-sync-state.json', { heartbeatAt: opts.heartbeatAt ?? '2026-10-05T11:59:00Z', jobs: {}, lastRounds: snap });
  w('second-best-season-3-submissions.json', subs);
  return dir;
}
