#!/usr/bin/env node
/**
 * ml-submission-status — ground truth for WHO submitted, from the Music League site.
 *
 * WHY THIS EXISTS: the "User Submitted" notification emails are lossy. Matt
 * never gets one for his own activity, and Music League silently dropped Darren
 * Paletz on R148/R149/R153 despite him submitting every time. So email absence
 * proves nothing, which makes it unsafe to conclude "did not submit" -- and that
 * conclusion matters, because a player who misses a round is out of it entirely.
 *
 * `rounds status` answers exactly that question and nothing more: it returns
 * {done:[uid], waiting:[uid]}. It never says WHICH song belongs to whom, so it
 * is safe to run while a guessing round is live -- same information class as the
 * emails we already ingest.
 *
 * Results land in round_submission_status, deliberately NOT in submission_events:
 * that table counts one row per email to derive churn ("Steiny resubmitted 6x"),
 * and mixing in CLI observations would invent phantom resubmissions.
 *
 *   node scripts/ml-submission-status.mjs               # every live round
 *   node scripts/ml-submission-status.mjs --round 150   # one round
 *   node scripts/ml-submission-status.mjs --dry-run
 *   node scripts/ml-submission-status.mjs --quiet       # cron mode: only report changes
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'ui/package.json'));
const Database = require('better-sqlite3');

const argvHas = (f) => process.argv.includes(f);
const argvVal = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const DRY = argvHas('--dry-run');
const QUIET = argvHas('--quiet');
const ONE_ROUND = argvVal('--round') ? Number(argvVal('--round')) : null;
const log = (...a) => { if (!QUIET) console.log(...a); };

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const ON_PHASE_CHANGE = argvHas('--on-phase-change');

const db = new Database(process.env.LEAGUE_DB ?? path.join(ROOT, 'data/league.db'));

// --on-phase-change: cheap guard so a short-interval timer costs nothing until a
// round actually transitions. round_events gains a row when the poller sees a
// "Round Starting" / "New Playlist" / "Votes Are In" email; anything newer than
// the stored watermark means a phase moved, which is exactly when a missing
// submission notification matters.
if (ON_PHASE_CHANGE) {
  db.exec(`CREATE TABLE IF NOT EXISTS submission_status_watermark (
    id INTEGER PRIMARY KEY CHECK (id = 1), seen_through TEXT NOT NULL)`);
  const latest = (db.prepare('SELECT MAX(occurred_at) AS m FROM round_events').get() ?? {}).m ?? '';
  const seen = (db.prepare('SELECT seen_through FROM submission_status_watermark WHERE id = 1').get() ?? {})
    .seen_through ?? '';
  if (!latest || latest <= seen) {
    if (!QUIET) console.log('no phase change since last check');
    process.exit(0);
  }
  if (!DRY) {
    db.prepare(`INSERT INTO submission_status_watermark (id, seen_through) VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET seen_through = excluded.seen_through`).run(latest);
  }
  console.log(`phase change detected (round_events through ${latest}) — reconciling`);
}
db.exec(`CREATE TABLE IF NOT EXISTS round_submission_status (
  round_id      INTEGER NOT NULL REFERENCES rounds(id),
  competitor_id INTEGER NOT NULL REFERENCES competitors(id),
  submitted     INTEGER NOT NULL,
  checked_at    TEXT NOT NULL,
  PRIMARY KEY (round_id, competitor_id)
)`);

// Live rounds only. Phase is DERIVED from the deadlines -- rounds.phase is dead
// data (zero 'voting' rows) and must never be trusted.
const now = new Date().toISOString();
const rounds = db.prepare(
  ONE_ROUND
    ? `SELECT r.id, r.name, r.ml_round_id AS mlRoundId, se.source_competition_id AS mlLeagueId
         FROM rounds r JOIN seasons se ON se.id = r.season_id
        WHERE r.id = ?`
    : `SELECT r.id, r.name, r.ml_round_id AS mlRoundId, se.source_competition_id AS mlLeagueId
         FROM rounds r JOIN seasons se ON se.id = r.season_id
        WHERE se.status = 'active'
          AND se.source_competition_id IS NOT NULL AND se.source_competition_id <> ''
          AND r.ml_round_id IS NOT NULL
          AND r.voting_deadline IS NOT NULL AND r.voting_deadline > ?
          AND r.submission_deadline IS NOT NULL
          AND datetime(r.submission_deadline, '-14 days') < ?
        ORDER BY r.id`,
).all(ONE_ROUND ?? now, ...(ONE_ROUND ? [] : [now]));

if (!rounds.length) { log('no live rounds to check'); process.exit(0); }

let anyChange = false;
for (const r of rounds) {
  if (!r.mlLeagueId || !r.mlRoundId) { log(`skip round ${r.id} — no ML ids`); continue; }

  // ACCOUNTING GUARD — don't spend a network call when nothing can be missing.
  //
  // Once the playlist exists we know exactly how many people submitted: one per
  // song (every league here is one song per person). Matt never generates a
  // notification for himself, so complete coverage is emailers == songs - 1.
  // Hitting that means every other submitter is already accounted for and the
  // CLI can tell us nothing new.
  //
  // Only applies once the playlist has landed. Before that songs = 0 and the
  // total is genuinely unknown, so we still check (that is also when "who is
  // still waiting" is the useful answer).
  const songs = (db.prepare('SELECT COUNT(*) n FROM ml_submissions WHERE round_id = ?').get(r.id)).n;
  const emailers = (db.prepare(
    'SELECT COUNT(DISTINCT submitter_name) n FROM submission_events WHERE round_id = ?',
  ).get(r.id)).n;
  if (songs > 0 && emailers >= songs - 1) {
    log(`round ${r.id} "${r.name}": all ${songs - 1} other submitters accounted for — skipping check`);
    continue;
  }

  let payload;
  try {
    const out = execFileSync('cli-web-musicleague',
      ['rounds', 'status', r.mlLeagueId, r.mlRoundId, '--json'],
      { encoding: 'utf8', timeout: 120_000 });
    payload = JSON.parse(out);
  } catch (e) {
    console.error(`[fail] round ${r.id} "${r.name}": ${e.message.slice(0, 160)}`);
    process.exitCode = 1;
    continue;
  }

  const byMlId = new Map(
    (db.prepare('SELECT id, ml_competitor_id AS ml, name FROM competitors').all())
      .filter((c) => c.ml).map((c) => [c.ml, c]),
  );
  const upsert = db.prepare(
    `INSERT INTO round_submission_status (round_id, competitor_id, submitted, checked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(round_id, competitor_id) DO UPDATE SET
       submitted = excluded.submitted, checked_at = excluded.checked_at`,
  );
  const prior = new Map(
    (db.prepare('SELECT competitor_id AS cid, submitted FROM round_submission_status WHERE round_id = ?')
      .all(r.id)).map((x) => [x.cid, x.submitted]),
  );

  const rows = [];
  for (const [uids, submitted] of [[payload.done ?? [], 1], [payload.waiting ?? [], 0]]) {
    for (const uid of uids) {
      const c = byMlId.get(uid);
      if (!c) { log(`  ? unknown ML user ${uid} (not in competitors)`); continue; }
      rows.push({ cid: c.id, name: c.name, submitted });
    }
  }
  if (!DRY) db.transaction(() => { for (const x of rows) upsert.run(r.id, x.cid, x.submitted, now); })();

  const changed = rows.filter((x) => prior.get(x.cid) !== x.submitted);
  if (changed.length) anyChange = true;

  const done = rows.filter((x) => x.submitted === 1);
  const waiting = rows.filter((x) => x.submitted === 0);
  log(`round ${r.id} "${r.name}": ${done.length} submitted, ${waiting.length} waiting`);
  if (waiting.length) log(`  waiting: ${waiting.map((x) => x.name).join(', ')}`);

  // The reason this job exists: submitted, but no notification email arrived.
  const emailed = new Set(
    db.prepare('SELECT DISTINCT submitter_name FROM submission_events WHERE round_id = ?')
      .all(r.id).map((x) => x.submitter_name),
  );
  const me = Number(
    (db.prepare("SELECT value FROM settings WHERE key LIKE 'guess_me_competitor:%'").get() ?? {}).value ?? 0,
  );
  const missed = done.filter((x) => !emailed.has(x.name) && x.cid !== me);
  if (missed.length) {
    console.log(`  MISSED EMAILS (submitted, no notification): ${missed.map((x) => x.name).join(', ')}`);
  }
  if (changed.length && QUIET) {
    console.log(`round ${r.id} "${r.name}": ${done.length} submitted, ${waiting.length} waiting`);
  }
}
if (DRY) log('(dry run — nothing written)');
db.close();
