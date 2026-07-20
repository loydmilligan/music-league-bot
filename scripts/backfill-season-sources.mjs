#!/usr/bin/env node
/**
 * One-time backfill of seasons.source_competition_id from verified ML league ids.
 * Idempotent: only sets rows where source_competition_id IS NULL. Dry-run by
 * default; --apply writes (backs up the DB first).
 */
import Database from 'better-sqlite3';
import { copyFileSync } from 'node:fs';

const DB_PATH = process.env.LEAGUE_DB ?? 'data/league.db';
const APPLY = process.argv.includes('--apply');

// (slug, season_number) -> verified live ML league id.
const MAP = [
  { slug: 'fam-jam',       season: 1, mlId: '9a133b6d27ce4ae5b9ce76745dc52ec0' },
  { slug: 'fam-jam',       season: 2, mlId: '65cb1570373a4541b21046787c2334a8' },
  { slug: 'fam-jam',       season: 3, mlId: 'e2a5ee4ad1ef4a5ca951d7b51c9b936e' },
  { slug: 'fam-jam',       season: 4, mlId: 'd3d3b2046a2c4c639976ca2621a8afa3' },
  { slug: 'hip-jammers',   season: 1, mlId: '0c5528f18f074d3296748583735ed7c7' },
  { slug: 'hip-jammers',   season: 2, mlId: 'b790807818f840ddadd37e37d9b71b98' },
  { slug: 'hip-jammers',   season: 3, mlId: 'b514fe6352994d6fadd602dee3cbaeb7' },
  { slug: 'second-best',   season: 1, mlId: '948e0131250c4ce1b449ab6b453261f6' },
  { slug: 'second-best',   season: 2, mlId: '78b2e6400520468e8d726e8793127fb0' },
  { slug: 'nostalgia-pit', season: 1, mlId: 'b2a0fb602548495ca4bf39f67c7d97d2' },
  { slug: 'boarz-ii-men',  season: 1, mlId: '71598b6952064ca4afe4baf437495604' },
];

const db = new Database(DB_PATH);
if (APPLY) {
  const bak = `${DB_PATH}.backup-backfill-source-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(DB_PATH, bak);
  console.log('Backed up DB → ' + bak);
} else {
  console.log('DRY-RUN. Use --apply to write.\n');
}

// Self-sufficient: on --apply, ensure the columns exist even if the app hasn't
// restarted with Task 1's boot migration yet. Additive + idempotent; the running
// app (old code) ignores the new columns. Dry-run writes nothing — it tolerates
// the column being absent (treats every mapped season as unset).
let hasCols = db.prepare('PRAGMA table_info(seasons)').all().some((c) => c.name === 'source_competition_id');
if (APPLY && !hasCols) {
  const cols = db.prepare('PRAGMA table_info(seasons)').all().map((c) => c.name);
  if (!cols.includes('source')) db.exec("ALTER TABLE seasons ADD COLUMN source TEXT NOT NULL DEFAULT 'music_league'");
  db.exec('ALTER TABLE seasons ADD COLUMN source_competition_id TEXT');
  hasCols = true;
}

// Prepared lazily: on a dry-run against a DB that predates the columns, the
// column doesn't exist yet, so we can't prepare this UPDATE. It's only ever run
// under --apply, which guarantees the columns above.
const upd = hasCols
  ? db.prepare(`UPDATE seasons SET source_competition_id = @mlId
      WHERE source_competition_id IS NULL
        AND season_number = @season
        AND league_id = (SELECT id FROM leagues WHERE slug = @slug)`)
  : null;

let changed = 0, missing = 0;
for (const m of MAP) {
  const row = db.prepare(`SELECT s.id ${hasCols ? ', s.source_competition_id AS sid' : ''}
    FROM seasons s JOIN leagues l ON l.id = s.league_id
    WHERE l.slug = ? AND s.season_number = ?`).get(m.slug, m.season);
  if (!row) { console.log(`  ? ${m.slug} s${m.season}: no season row (skip)`); missing++; continue; }
  const sid = hasCols ? row.sid : null;
  if (sid) { console.log(`  = ${m.slug} s${m.season}: already ${sid.slice(0, 8)} (skip)`); continue; }
  console.log(`  ${APPLY ? '+' : '~'} ${m.slug} s${m.season} → ${m.mlId.slice(0, 8)}`);
  if (APPLY) changed += upd.run(m).changes;
}
console.log(`\n${APPLY ? `Applied: ${changed} updated` : 'Dry-run complete'}${missing ? `, ${missing} missing` : ''}.`);
