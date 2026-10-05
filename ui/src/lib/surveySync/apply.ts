// Writes a parsed survey league into the bot DB: season row + rounds keyed by
// ml_round_id, all marked managed_by='survey'. Never deletes. One transaction.
import type Database from 'better-sqlite3';
import type { SurveyLeague } from './parse.js';

export interface ApplyResult { seasonId: number; inserted: number; updated: number; warnings: string[] }

// WhatsApp-ish names use NBSP / U+202F; fold all whitespace before comparing.
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();

function playerMatcher(db: Database.Database, leagueId: number): (name: string) => number | null {
  const byName = new Map<string, number>();
  for (const p of db.prepare('SELECT id, name FROM players').all() as Array<{ id: number; name: string }>) {
    byName.set(norm(p.name), p.id);
  }
  const byIdentity = new Map<string, number>();
  for (const r of db.prepare(
    'SELECT player_id, identifier FROM player_identities WHERE league_id IS NULL OR league_id = ?',
  ).all(leagueId) as Array<{ player_id: number; identifier: string }>) {
    if (!byIdentity.has(norm(r.identifier))) byIdentity.set(norm(r.identifier), r.player_id);
  }
  return name => byName.get(norm(name)) ?? byIdentity.get(norm(name)) ?? null;
}

export function applySurveyLeague(db: Database.Database, league: SurveyLeague, nowIso: string): ApplyResult {
  const leagueRow = db.prepare('SELECT id FROM leagues WHERE slug = ?').get(league.slug) as { id: number } | undefined;
  if (!leagueRow) throw new Error(`unknown bot league: ${league.slug}`);
  const leagueId = leagueRow.id;
  const matchPlayer = playerMatcher(db, leagueId);
  const warnings = [...league.warnings];

  return db.transaction(() => {
    let season = db.prepare('SELECT id FROM seasons WHERE league_id = ? AND season_number = ?')
      .get(leagueId, league.seasonNumber) as { id: number } | undefined;
    if (!season) {
      season = db.prepare(`INSERT INTO seasons (league_id, season_number, status, source_competition_id, managed_by)
        VALUES (?, ?, 'active', ?, 'survey') RETURNING id`).get(leagueId, league.seasonNumber, league.mlLeagueId) as { id: number };
    } else {
      db.prepare("UPDATE seasons SET source_competition_id = ?, managed_by = 'survey' WHERE id = ?")
        .run(league.mlLeagueId, season.id);
    }
    const seasonId = season.id;

    const existing = db.prepare('SELECT * FROM rounds WHERE ml_round_id = ?');
    const insert = db.prepare(`INSERT INTO rounds (season_id, ml_round_id, name, description, submission_deadline,
        voting_deadline, created_at, round_number, managed_by)
      VALUES (@seasonId, @mlRoundId, @name, @description, @sub, @vote, @createdAt, @number, 'survey')`);
    const update = db.prepare(`UPDATE rounds SET season_id=@seasonId, name=@name, description=@description,
        submission_deadline=@sub, voting_deadline=@vote, round_number=@number, managed_by='survey' WHERE id=@id`);
    const setRevealed = db.prepare(`UPDATE rounds SET theme_submitted_by=@by, comment_level=@level,
        comment_visibility=@visibility, comment_prompt=@prompt WHERE id=@id`);

    let inserted = 0, updated = 0;
    for (const r of league.rounds) {
      const base = { seasonId, mlRoundId: r.mlRoundId, name: r.name, description: r.description,
        sub: r.submissionDeadline, vote: r.votingDeadline, number: r.number };
      const before = existing.get(r.mlRoundId) as any;
      let id: number;
      if (!before) {
        id = Number(insert.run({ ...base, createdAt: nowIso }).lastInsertRowid);
        inserted++;
      } else {
        id = before.id;
        update.run({ ...base, id });
      }
      if (r.revealed) {
        let by: number | null = null;
        for (const name of r.credits) {
          const pid = matchPlayer(name);
          if (pid !== null) { by = pid; break; }
        }
        const unmatched = r.credits.filter(n => matchPlayer(n) === null);
        if (unmatched.length) warnings.push(`round ${r.number}: no bot player named ${unmatched.join(', ')}`);
        setRevealed.run({ id, by, level: r.comment?.level ?? null, visibility: r.comment?.visibility ?? null,
          prompt: r.comment?.prompt ?? null });
      }
      if (before) {
        const after = existing.get(r.mlRoundId) as any;
        const keys = ['season_id', 'name', 'description', 'submission_deadline', 'voting_deadline', 'round_number',
          'managed_by', 'theme_submitted_by', 'comment_level', 'comment_visibility', 'comment_prompt'];
        if (keys.some(k => before[k] !== after[k])) updated++;
      }
    }
    return { seasonId, inserted, updated, warnings };
  })();
}
