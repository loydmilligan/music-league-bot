import { it, expect } from 'vitest';
import { openLeagueDb } from './client.js';
import { seedLeagues, upsertSeason, getSeasonsForLeague } from './leagues.js';
import { upsertRound, getRoundById } from './rounds.js';

function setup() {
  const db = openLeagueDb(':memory:');
  seedLeagues(db);
  const leagueId = (db.prepare("SELECT id FROM leagues WHERE slug='second-best'").get() as { id: number }).id;
  const seasonId = upsertSeason(db, leagueId, 3, 'active');
  return { db, leagueId, seasonId };
}

it('adds survey-managed columns and maps them on Round and Season', () => {
  const { db, leagueId, seasonId } = setup();
  const id = upsertRound(db, seasonId, {
    mlRoundId: 'm1', name: 'R1', description: 'd', spotifyPlaylistUrl: '', createdAt: '2026-10-01T00:00:00Z',
  });
  db.prepare(`UPDATE rounds SET managed_by='survey', comment_level='required',
    comment_visibility='after-voting', comment_prompt='tell us' WHERE id=?`).run(id);
  db.prepare("UPDATE seasons SET managed_by='survey' WHERE id=?").run(seasonId);
  const r = getRoundById(db, id)!;
  expect(r.managedBy).toBe('survey');
  expect(r.commentLevel).toBe('required');
  expect(r.commentVisibility).toBe('after-voting');
  expect(r.commentPrompt).toBe('tell us');
  expect(getSeasonsForLeague(db, leagueId)[0].managedBy).toBe('survey');
});

it('export importer does not overwrite name/description of a survey-managed round', () => {
  const { db, seasonId } = setup();
  const id = upsertRound(db, seasonId, {
    mlRoundId: 'm2', name: 'Survey Title', description: 'Survey desc', spotifyPlaylistUrl: '', createdAt: '2026-10-01T00:00:00Z',
  });
  db.prepare("UPDATE rounds SET managed_by='survey' WHERE id=?").run(id);
  upsertRound(db, seasonId, {
    mlRoundId: 'm2', name: 'Export Title', description: 'Export desc', spotifyPlaylistUrl: 'https://x', createdAt: '2026-10-01T00:00:00Z',
  });
  const r = getRoundById(db, id)!;
  expect(r.name).toBe('Survey Title');
  expect(r.description).toBe('Survey desc');
  expect(r.spotifyPlaylistUrl).toBe('https://x');
});

it('export importer still updates unmanaged rounds', () => {
  const { db, seasonId } = setup();
  const id = upsertRound(db, seasonId, {
    mlRoundId: 'm3', name: 'Old', description: 'Old', spotifyPlaylistUrl: '', createdAt: '2026-10-01T00:00:00Z',
  });
  upsertRound(db, seasonId, {
    mlRoundId: 'm3', name: 'New', description: 'New', spotifyPlaylistUrl: '', createdAt: '2026-10-01T00:00:00Z',
  });
  expect(getRoundById(db, id)!.name).toBe('New');
});

it('locks survey-owned PATCH fields on managed rounds only', async () => {
  const { surveyLockedFieldsIn } = await import('./rounds.js');
  expect(surveyLockedFieldsIn({ managedBy: 'survey' }, { name: 'x', tag: '90s', theme_submitted_by: 3 }))
    .toEqual(['name', 'theme_submitted_by']);
  expect(surveyLockedFieldsIn({ managedBy: 'survey' }, { tag: '90s', video_playlist_config: null })).toEqual([]);
  expect(surveyLockedFieldsIn({ managedBy: null }, { name: 'x' })).toEqual([]);
});
