#!/usr/bin/env node
/**
 * nightly-review — local Music League operator queue.
 *
 * Host-side by design: the useful state is data/league.db, the repo .env ntfy
 * config, and the Music League CLI/session. This script does not post to Music
 * League or WhatsApp. It writes a markdown report and optionally sends an ntfy
 * summary that points Matt at the next manual task.
 */
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_DIR = path.join(ROOT, 'out', 'nightly-review');
const DB_PATH = process.env.LEAGUE_DB || path.join(ROOT, 'data', 'league.db');
const DRY_RUN = process.argv.includes('--dry-run');
const NO_NOTIFY = process.argv.includes('--no-notify');
const NO_AI = process.argv.includes('--no-ai');

function parseEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    out[key] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = {
  ...parseEnv('/home/loydmilligan/sysops-agent/.env'),
  ...parseEnv(path.join(ROOT, '.env')),
  ...process.env,
};

function isoNow() {
  return new Date().toISOString();
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function phaseForRound(round, nowMs) {
  const sub = round.submission_deadline ? Date.parse(round.submission_deadline) : null;
  const vote = round.voting_deadline ? Date.parse(round.voting_deadline) : null;
  if (vote !== null && nowMs >= vote) return 'archive';
  if (sub !== null && nowMs >= sub) return vote === null ? 'archive' : 'voting';
  return 'submission';
}

function query(db, sql, ...args) {
  return db.prepare(sql).all(...args);
}

function getActiveRounds(db) {
  const nowMs = Date.now();
  const leagues = query(
    db,
    `SELECT id, slug, name, is_active, active_round_id
       FROM leagues
      WHERE is_active = 1
      ORDER BY slug`,
  );
  const out = [];
  for (const league of leagues) {
    const rounds = query(
      db,
      `SELECT r.id, r.name, r.description, r.submission_deadline, r.voting_deadline,
              r.phase, r.round_number, s.id AS season_id, s.season_number
         FROM rounds r
         JOIN seasons s ON s.id = r.season_id
        WHERE s.league_id = ?
        ORDER BY s.season_number DESC, r.id`,
      league.id,
    );
    const manual = rounds.find((r) => r.id === league.active_round_id) || null;
    const live = rounds
      .map((r) => ({ ...r, derived_phase: phaseForRound(r, nowMs) }))
      .find((r) => r.derived_phase === 'submission' || r.derived_phase === 'voting') || null;
    const chosen = manual || live;
    if (!chosen) {
      out.push({ league, round: null, manual, live, issue: 'No active round resolved' });
      continue;
    }
    const derived = phaseForRound(chosen, nowMs);
    const songs = db.prepare('SELECT COUNT(*) AS n FROM ml_submissions WHERE round_id = ?').get(chosen.id).n;
    const digest = db.prepare(
      `SELECT d.id, d.generated_at, d.finalized_at, ds.slug AS share_slug,
              (SELECT MAX(sent_at) FROM digest_sends WHERE round_id = d.round_id) AS sent_at
         FROM digest_drafts d
         LEFT JOIN digest_shares ds ON ds.round_id = d.round_id
        WHERE d.round_id = ?
        ORDER BY d.generated_at DESC
        LIMIT 1`,
    ).get(chosen.id) || null;
    out.push({ league, round: { ...chosen, derived_phase: derived, songs, digest }, manual, live });
  }
  return out;
}

function getDigestDue(db) {
  return query(
    db,
    `SELECT r.id, l.slug, l.name AS league_name, r.name, r.voting_deadline,
            COUNT(ms.spotify_uri) AS songs,
            MAX(d.generated_at) AS draft_generated_at,
            MAX(d.finalized_at) AS draft_finalized_at,
            MAX(ds.sent_at) AS sent_at
       FROM rounds r
       JOIN seasons s ON s.id = r.season_id
       JOIN leagues l ON l.id = s.league_id
       LEFT JOIN ml_submissions ms ON ms.round_id = r.id
       LEFT JOIN digest_drafts d ON d.round_id = r.id
       LEFT JOIN digest_sends ds ON ds.round_id = r.id
      WHERE l.is_active = 1
        AND r.voting_deadline IS NOT NULL
        AND datetime(r.voting_deadline) <= datetime('now')
      GROUP BY r.id
      ORDER BY datetime(r.voting_deadline) DESC
      LIMIT 8`,
  );
}

function getRecentFailures(db) {
  const rows = [];
  for (const table of ['digest_jobs', 'ytm_drops']) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) continue;
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (cols.includes('error')) {
      const tsCol = ['updated_at', 'created_at', 'sent_at', 'claimed_at'].find((c) => cols.includes(c));
      const tsExpr = tsCol ? `${tsCol} AS updated_at` : `NULL AS updated_at`;
      const order = tsCol ? `ORDER BY ${tsCol} DESC` : '';
      rows.push(...query(db, `SELECT '${table}' AS source, error, ${tsExpr} FROM ${table} WHERE error IS NOT NULL AND error != '' ${order} LIMIT 5`));
    }
  }
  return rows;
}

function getGitStatus() {
  const status = spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
  if (status.status !== 0) return ['git status failed'];
  return status.stdout.trim().split('\n').filter(Boolean);
}

function getVotingContexts(db, active) {
  const contexts = [];
  for (const item of active) {
    if (!item.round || item.round.derived_phase !== 'voting') continue;
    const roundId = item.round.id;
    const songs = query(
      db,
      `SELECT spotify_uri, title, artists, comment
         FROM ml_submissions
        WHERE round_id = ?
        ORDER BY title`,
      roundId,
    );
    const roster = query(
      db,
      `SELECT DISTINCT c.id, c.name
         FROM competitors c
         JOIN season_players sp ON sp.player_id = c.player_id
        WHERE sp.season_id = ?
        ORDER BY c.name`,
      item.round.season_id,
    );
    const history = query(
      db,
      `SELECT c.name AS submitter, r.name AS round_name, ms.title, ms.artists, ms.comment
         FROM ml_submissions ms
         JOIN competitors c ON c.id = ms.competitor_id
         JOIN rounds r ON r.id = ms.round_id
        WHERE ms.round_id != ?
          AND c.player_id IN (SELECT player_id FROM season_players WHERE season_id = ?)
        ORDER BY ms.created_at DESC
        LIMIT 80`,
      roundId,
      item.round.season_id,
    );
    const existingPicks = query(
      db,
      `SELECT gp.spotify_uri, c.name AS final_pick, gp.confidence, gp.explanation, gp.comment
         FROM guess_picks gp
         LEFT JOIN competitors c ON c.id = gp.final_pick_player_id
        WHERE gp.round_id = ?
        ORDER BY gp.spotify_uri`,
      roundId,
    );
    contexts.push({ item, songs, roster, history, existingPicks });
  }
  return contexts;
}

function runClaudeGuessDraft(ctx) {
  if (NO_AI || ctx.songs.length === 0 || ctx.roster.length === 0) return null;
  const prompt = [
    'You are helping Matt play a private Music League "guess the submitter" game.',
    'Draft guesses and short public comments in Matt’s voice. Do not claim certainty.',
    'Use only the anonymous current song list plus prior-round history below.',
    'Return markdown only: a table with Song, Guess, Confidence, Why, Draft comment; then 3 notes for Matt.',
    '',
    `League: ${ctx.item.league.name} (${ctx.item.league.slug})`,
    `Round: ${ctx.item.round.name} (#${ctx.item.round.id})`,
    '',
    'Current anonymous songs:',
    JSON.stringify(ctx.songs, null, 2),
    '',
    'Eligible roster:',
    JSON.stringify(ctx.roster, null, 2),
    '',
    'Prior submission history sample:',
    JSON.stringify(ctx.history, null, 2),
    '',
    'Existing saved picks/comments, if any:',
    JSON.stringify(ctx.existingPicks, null, 2),
  ].join('\n');
  const res = spawnSync('claude', ['-p', prompt], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
  });
  if (res.status !== 0) {
    return `Claude draft failed: ${(res.stderr || res.stdout || '').trim().slice(0, 800)}`;
  }
  return res.stdout.trim();
}

async function notify(title, body, click) {
  if (DRY_RUN || NO_NOTIFY) {
    console.log(`[dry-run] ntfy: ${title}\n${body}`);
    return;
  }
  const server = env.NTFY_URL || env.MD_NTFY_SERVER || 'https://ntfy.mattmariani.com';
  const topic = env.NTFY_TOPIC_ALERTS || env.NTFY_TOPIC || env.MD_NTFY_TOPIC || 'mlbot-alerts';
  const token = env.NTFY_TOKEN || env.CC_NTFY_TOKEN || '';
  const headers = {
    Title: title.replace(/[^\x20-\x7E]/g, '?'),
    Priority: 'default',
    Tags: 'musical_note,clipboard',
    'User-Agent': 'mlbot-nightly-review/1.0',
  };
  if (click) headers.Click = click;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${server.replace(/\/$/, '')}/${topic}`, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`ntfy HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

function mdTable(rows, cols) {
  if (!rows.length) return '_None._';
  const head = `| ${cols.map((c) => c[0]).join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${cols.map(([, f]) => String(f(r) ?? '—').replace(/\n/g, '<br>').replace(/\|/g, '\\|')).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const active = getActiveRounds(db);
  const digestDue = getDigestDue(db);
  const failures = getRecentFailures(db);
  const gitStatus = getGitStatus();
  const voting = getVotingContexts(db, active);
  const aiDrafts = [];
  for (const ctx of voting) {
    aiDrafts.push({ ctx, draft: runClaudeGuessDraft(ctx) });
  }

  const tasks = [];
  for (const item of active) {
    if (!item.round) {
      tasks.push(`Set active round for ${item.league.slug}.`);
      continue;
    }
    if (item.manual && item.live && item.manual.id !== item.live.id) {
      tasks.push(`${item.league.slug}: active pointer is ${item.manual.id}, but deadline-derived live round looks like ${item.live.id}. Reconcile the active round slot.`);
    }
    if (item.round.derived_phase === 'voting' && item.round.songs === 0) {
      tasks.push(`${item.league.slug} r${item.round.id}: voting phase but no ml_submissions rows. Run/import Music League sync before guessing.`);
    }
  }
  const nextDigest = digestDue.find((r) => !r.sent_at && !r.draft_finalized_at) || digestDue[0] || null;
  if (nextDigest && !nextDigest.sent_at) {
    tasks.push(`Next digest due: ${nextDigest.slug} r${nextDigest.id} "${nextDigest.name}" (${nextDigest.songs} songs, vote deadline ${fmtDate(nextDigest.voting_deadline)}).`);
  }
  if (failures.length) tasks.push(`Review ${failures.length} recent pipeline error(s).`);
  if (gitStatus.length) tasks.push(`Repo has ${gitStatus.length} uncommitted git status item(s); avoid mixing automation changes with manual work.`);

  const report = [
    `# Nightly Music League Bot Review`,
    '',
    `Generated: ${isoNow()}`,
    '',
    '## Recommended next queue',
    '',
    tasks.length ? tasks.map((t, i) => `${i + 1}. ${t}`).join('\n') : '_No urgent tasks found._',
    '',
    '## Active rounds',
    '',
    mdTable(active, [
      ['League', (r) => r.league.slug],
      ['Round', (r) => r.round ? `r${r.round.id} ${r.round.name}` : '—'],
      ['Phase', (r) => r.round?.derived_phase],
      ['Sub deadline', (r) => fmtDate(r.round?.submission_deadline)],
      ['Vote deadline', (r) => fmtDate(r.round?.voting_deadline)],
      ['Songs', (r) => r.round?.songs],
      ['Digest', (r) => r.round?.digest?.finalized_at ? 'finalized' : r.round?.digest?.generated_at ? 'drafted' : 'none'],
    ]),
    '',
    '## Digest due / recent completed rounds',
    '',
    mdTable(digestDue, [
      ['League', (r) => r.slug],
      ['Round', (r) => `r${r.id} ${r.name}`],
      ['Vote deadline', (r) => fmtDate(r.voting_deadline)],
      ['Songs', (r) => r.songs],
      ['Draft', (r) => r.draft_generated_at ? fmtDate(r.draft_generated_at) : 'none'],
      ['Finalized', (r) => r.draft_finalized_at ? fmtDate(r.draft_finalized_at) : 'no'],
      ['Sent', (r) => r.sent_at ? fmtDate(r.sent_at) : 'no'],
    ]),
    '',
    '## Guess the submitter',
    '',
    voting.length ? voting.map((ctx) => [
      `### ${ctx.item.league.slug} r${ctx.item.round.id}: ${ctx.item.round.name}`,
      '',
      ctx.songs.length ? mdTable(ctx.songs, [
        ['Song', (s) => s.title],
        ['Artists', (s) => s.artists],
        ['Comment', (s) => s.comment || ''],
      ]) : '_No visible submissions in `ml_submissions` yet._',
    ].join('\n')).join('\n\n') : '_No active voting rounds found._',
    '',
    '## AI guess/comment drafts',
    '',
    aiDrafts.length ? aiDrafts.map(({ ctx, draft }) => [
      `### ${ctx.item.league.slug} r${ctx.item.round.id}`,
      '',
      draft || '_Skipped: no songs/roster or AI disabled._',
    ].join('\n')).join('\n\n') : '_No AI drafts generated._',
    '',
    '## Recent pipeline issues',
    '',
    mdTable(failures, [
      ['Source', (r) => r.source],
      ['Updated', (r) => fmtDate(r.updated_at)],
      ['Error', (r) => r.error],
    ]),
    '',
    '## Git status',
    '',
    gitStatus.length ? '```text\n' + gitStatus.join('\n') + '\n```' : '_Clean._',
    '',
  ].join('\n');

  const stamp = isoNow().replace(/[:.]/g, '-');
  const reportPath = path.join(OUT_DIR, `${stamp}.md`);
  const latestPath = path.join(OUT_DIR, 'latest.md');
  writeFileSync(reportPath, report);
  writeFileSync(latestPath, report);

  const summary = [
    tasks.slice(0, 4).map((t, i) => `${i + 1}. ${t}`).join('\n') || 'No urgent Music League bot tasks found.',
    '',
    `Report: ${latestPath}`,
  ].join('\n');
  const click = env.PUBLIC_APP_BASE_URL ? env.PUBLIC_APP_BASE_URL.replace(/\/$/, '') : undefined;
  await notify('Music League nightly queue', summary, click);
  console.log(`wrote ${latestPath}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
