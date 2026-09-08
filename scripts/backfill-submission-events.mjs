#!/usr/bin/env node
/**
 * Backfill submission_events from already-archived "User Submitted" emails.
 *
 * These were captured from the start but never classified (parsed_type='other'),
 * so the churn they record — a person submitting more than once in a round, i.e.
 * a mid-round pick change — was invisible. The raw MIME was retained, so this is
 * fully recoverable without refetching anything from the network.
 *
 * Idempotent: submission_events is keyed on message_id, so replays add nothing.
 *
 *   node scripts/backfill-submission-events.mjs [--dry-run]
 *   LEAGUE_DB=/path/to/copy.db node scripts/backfill-submission-events.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// emailIngest.ts uses TS-style `.js` specifiers that resolve to `.ts` files,
// which Node's built-in type stripping cannot follow. Re-exec once under tsx,
// exactly as scripts/ml-comment-sync.mjs does, so plain `node …` still works.
const TSX_LOADER = resolve(REPO_ROOT, 'node_modules/tsx/dist/loader.mjs');
if (!process.env.BACKFILL_SUB_EVENTS_TSX) {
  if (!existsSync(TSX_LOADER)) {
    console.error(`backfill: tsx not installed at ${TSX_LOADER}; run npm install at the repo root`);
    process.exit(2);
  }
  const child = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(TSX_LOADER).href, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { cwd: REPO_ROOT, stdio: 'inherit', env: { ...process.env, BACKFILL_SUB_EVENTS_TSX: '1' } },
  );
  process.exit(child.status ?? 1);
}

const { createRequire } = await import('node:module');
const require = createRequire(resolve(REPO_ROOT, 'ui/package.json'));
const Database = require('better-sqlite3');
const { parseEmail } = await import('../src/email/emailParser.ts');
const { ensureEmailSchema, ingestParsedEmail } = await import('../src/email/emailIngest.ts');

const DRY = process.argv.includes('--dry-run');
const db = new Database(process.env.LEAGUE_DB ?? resolve(REPO_ROOT, 'data/league.db'));
ensureEmailSchema(db);

const rows = db
  .prepare(`SELECT message_id, raw FROM email_messages WHERE subject LIKE '%User Submitted%' ORDER BY sent_at`)
  .all();
console.log(`${rows.length} archived "User Submitted" email(s)`);

// parseEmail is async, so parse everything first, then write in one transaction.
const parsed = [];
let unparseable = 0;
for (const r of rows) {
  const p = await parseEmail(r.raw);
  if (p.type !== 'user_submitted' || !p.submitterName) { unparseable++; continue; }
  parsed.push(p);
}

if (!DRY) {
  // raw:'' so the archive row keeps the MIME it already has rather than being
  // blanked — ingestParsedEmail's upsert does not touch `raw`.
  db.transaction(() => { for (const p of parsed) ingestParsedEmail(db, p, { raw: '' }); })();
}

console.log(`parsed ${parsed.length}, unparseable ${unparseable}`);
if (DRY) {
  console.log('(dry run — nothing written)');
} else {
  const s = db.prepare(`SELECT COUNT(*) total, SUM(round_id IS NULL) unmapped FROM submission_events`).get();
  console.log(`submission_events: ${s.total} rows, ${s.unmapped} could not be mapped to a round`);
}
db.close();
