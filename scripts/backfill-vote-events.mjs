#!/usr/bin/env node
/**
 * Backfill vote_events from archived "User Voted" emails.
 *
 * Dry run by default (parses and counts, writes nothing). Pass --write to insert.
 * Re-parses email_messages rows whose subject ends in "User Voted" and inserts
 * into vote_events only, with INSERT OR IGNORE, so replays add nothing and no
 * other table (email_messages, round_events, rounds) is touched.
 *
 *   node scripts/backfill-vote-events.mjs            # dry run
 *   node scripts/backfill-vote-events.mjs --write
 *   LEAGUE_DB=/path/to/copy.db node scripts/backfill-vote-events.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The email modules use `.js` specifiers that resolve to `.ts`; re-exec once
// under tsx (same trick as backfill-submission-events.mjs).
const TSX_LOADER = resolve(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs');
if (!process.env.BACKFILL_VOTE_EVENTS_TSX) {
  if (!existsSync(TSX_LOADER)) {
    console.error(`backfill: tsx not installed at ${TSX_LOADER}; run npm install at the repo root`);
    process.exit(2);
  }
  const child = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(TSX_LOADER).href, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, BACKFILL_VOTE_EVENTS_TSX: '1' } },
  );
  process.exit(child.status ?? 1);
}

const { createRequire } = await import('node:module');
const require = createRequire(resolve(REPO_ROOT, 'ui/package.json'));
const Database = require('better-sqlite3');
const { parseEmail } = await import('../src/email/emailParser.ts');
const { ensureEmailSchema, resolveLeagueIdFromLabel } = await import('../src/email/emailIngest.ts');

const WRITE = process.argv.includes('--write');
// A dry run opens the file read-only, and a missing file is an error, never a fresh empty database.
const db = new Database(process.env.LEAGUE_DB ?? resolve(REPO_ROOT, 'data/league.db'), { readonly: !WRITE, fileMustExist: true });
if (WRITE) ensureEmailSchema(db);

const rows = db
  .prepare(`SELECT message_id, raw FROM email_messages WHERE subject LIKE '%User Voted' ORDER BY sent_at`)
  .all();
console.log(`${rows.length} archived "User Voted" email(s)`);

const parsed = [];
let failures = 0;
for (const r of rows) {
  const p = await parseEmail(r.raw);
  if (p.type !== 'user_voted' || !p.voterName) { failures++; continue; }
  parsed.push({ ...p, messageId: r.message_id });
}

// Map to a round by name within the league, same rule as ingest (no league-wide fallback).
const roundFor = db.prepare(
  `SELECT r.id FROM rounds r JOIN seasons s ON s.id = r.season_id
   WHERE r.name = ? AND (? IS NULL OR s.league_id = ?) ORDER BY r.created_at DESC LIMIT 1`,
);
let mapped = 0;
const toInsert = parsed.map((p) => {
  let roundId = null;
  if (p.roundName) {
    const leagueId = resolveLeagueIdFromLabel(db, p.leagueLabel);
    if (!(p.leagueLabel && leagueId == null)) roundId = roundFor.get(p.roundName, leagueId, leagueId)?.id ?? null;
  }
  if (roundId != null) mapped++;
  return { p, roundId };
});

console.log(`parsed ${parsed.length}, failures ${failures}, mapped to a round ${mapped}, unmapped ${parsed.length - mapped}`);
if (!WRITE) {
  console.log('(dry run: nothing written; pass --write to insert)');
} else {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO vote_events (message_id, round_id, voter_name, league_label, round_name, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  db.transaction(() => {
    for (const { p, roundId } of toInsert) inserted += ins.run(p.messageId, roundId, p.voterName, p.leagueLabel, p.roundName, p.sentAt).changes;
  })();
  console.log(`inserted ${inserted}, already present ${toInsert.length - inserted}`);
}
db.close();
