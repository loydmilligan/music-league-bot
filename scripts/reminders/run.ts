#!/usr/bin/env tsx
/**
 * Dual-channel reminder tick. Live Music League deadlines win; missing numbers
 * skip WhatsApp. No ntfy↔WhatsApp fallback. Writes data/reminder-sends.json.
 *
 *   SURVEY_DATA_DIR   player-settings JSON (survey app data/)
 *   BOT_CONTROL_URL   http://127.0.0.1:3003  (POST /dm)
 *   NTFY_URL          https://ntfy.mattmariani.com
 *   NTFY_TOKEN        optional
 *   REMINDERS_USE_CLI=1  fetch deadlines via cli-web-musicleague
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectDueSends, deadlineFires, newsFires, playersFromSettings, type DeadlineInput, type NewsInput } from '../../src/reminders/runner.js';
import type { PlannedSend } from '../../src/reminders/core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SURVEY_DATA = process.env.SURVEY_DATA_DIR || path.join(ROOT, '../boarz-season-2-survey/data');
const SENT_FILE = process.env.REMINDER_SENT_FILE || path.join(ROOT, 'data/reminder-sends.json');
const BOT = (process.env.BOT_CONTROL_URL || 'http://127.0.0.1:3003').replace(/\/+$/, '');
const NTFY = (process.env.NTFY_URL || 'https://ntfy.mattmariani.com').replace(/\/+$/, '');
const NTFY_TOKEN = process.env.NTFY_TOKEN || '';
const WINDOW_MS = Number(process.env.REMINDER_WINDOW_MS || 20 * 60_000);
const DIGEST = 'https://digest.mattmariani.com';

const LEAGUES = [
  {
    name: 'Boarz',
    leagueId: '46aae7ef10fe414a8989b19702f7d512',
    settings: 'player-settings.json',
    news: 'portal-news.json',
    slug: 'U7o8L06wfe1HILD1qzk-wg',
  },
  {
    name: 'Second Best',
    leagueId: '32c57c48ed2f40808c01b8967291b06a',
    settings: 'second-best-player-settings.json',
    news: 'second-best-portal-news.json',
    slug: 'yFfer5bePejN4PRXvgAfMg',
  },
];

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function cliJson(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('cli-web-musicleague', [...args, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(err.trim() || `cli exit ${code}`));
      else {
        try { resolve(JSON.parse(out)); }
        catch (e) { reject(e); }
      }
    });
  });
}

async function liveDeadlines(leagueId: string, leagueName: string, slug: string): Promise<DeadlineInput[]> {
  const raw = await cliJson(['rounds', 'themes', leagueId]) as Array<{
    id?: string; number?: number; name?: string; roundStatus?: string;
    submissions_due_utc?: string; votes_due_utc?: string;
  }>;
  const click = `${DIGEST}/${slug}/season`;
  const out: DeadlineInput[] = [];
  for (const r of raw) {
    const n = r.number ?? r.name ?? r.id;
    if (r.submissions_due_utc) {
      out.push({
        key: `${leagueId}:${r.id}:songs`,
        at: Date.parse(r.submissions_due_utc),
        title: `${leagueName} songs due`,
        body: `Round ${n} submissions close soon.`,
        click,
      });
    }
    if (r.votes_due_utc) {
      out.push({
        key: `${leagueId}:${r.id}:votes`,
        at: Date.parse(r.votes_due_utc),
        title: `${leagueName} votes due`,
        body: `Round ${n} voting closes soon.`,
        click,
      });
    }
  }
  return out.filter((d) => Number.isFinite(d.at));
}

async function sendNtfy(send: PlannedSend): Promise<boolean> {
  const headers: Record<string, string> = {
    Title: send.title,
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (send.click) headers.Click = send.click;
  if (NTFY_TOKEN) headers.Authorization = `Bearer ${NTFY_TOKEN}`;
  const res = await fetch(`${NTFY}/${encodeURIComponent(send.target)}`, {
    method: 'POST',
    headers,
    body: send.body,
  });
  return res.ok;
}

function e164FromTarget(target: string): string {
  return target.endsWith('@c.us') ? `+${target.slice(0, -5)}` : target;
}

async function sendDm(send: PlannedSend): Promise<{ sent: boolean; reason?: string }> {
  const text = send.click ? `${send.title}\n${send.body}\n${send.click}` : `${send.title}\n${send.body}`;
  const res = await fetch(`${BOT}/dm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: e164FromTarget(send.target), text }),
  });
  return res.json().catch(() => ({ sent: false, reason: `bot ${res.status}` })) as Promise<{ sent: boolean; reason?: string }>;
}

async function main() {
  const now = Date.now();
  const sentDoc = await readJson<{ keys: string[] }>(SENT_FILE, { keys: [] });
  const already = new Set(sentDoc.keys);
  const planned: PlannedSend[] = [];

  for (const league of LEAGUES) {
    const settings = await readJson<Record<string, Parameters<typeof playersFromSettings>[0][string]>>(
      path.join(SURVEY_DATA, league.settings),
      {},
    );
    const players = playersFromSettings(settings);
    const newsRaw = await readJson<Array<{ id: string; title: string; body: string; publishedAt: string; unpublished?: boolean }>>(
      path.join(SURVEY_DATA, league.news),
      [],
    );
    const news: NewsInput[] = newsRaw
      .filter((n) => n.unpublished !== true)
      .map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        publishedAt: Date.parse(n.publishedAt),
        click: `${DIGEST}/${league.slug}/`,
      }))
      .filter((n) => Number.isFinite(n.publishedAt));

    let deadlines: DeadlineInput[] = [];
    if (process.env.REMINDERS_USE_CLI === '1') {
      try {
        deadlines = await liveDeadlines(league.leagueId, league.name, league.slug);
      } catch (e) {
        console.error(`[reminders] ${league.name} CLI deadlines failed:`, e instanceof Error ? e.message : e);
      }
    }

    const fires = [
      ...deadlineFires(deadlines, now, WINDOW_MS),
      ...newsFires(news, now),
    ];
    planned.push(...collectDueSends({ players, fires, alreadySent: already }));
  }

  const recorded: string[] = [];
  for (const send of planned) {
    try {
      if (send.channel === 'ntfy') {
        const ok = await sendNtfy(send);
        if (ok) recorded.push(send.key);
        else console.error(`[reminders] ntfy failed ${send.key}`);
      } else {
        const r = await sendDm(send);
        if (r.sent) recorded.push(send.key);
        else console.error(`[reminders] whatsapp skip ${send.key}: ${r.reason ?? 'not sent'}`);
      }
    } catch (e) {
      console.error(`[reminders] ${send.channel} ${send.key}:`, e instanceof Error ? e.message : e);
    }
  }

  if (recorded.length) {
    for (const k of recorded) already.add(k);
    await fs.mkdir(path.dirname(SENT_FILE), { recursive: true });
    await fs.writeFile(SENT_FILE, JSON.stringify({ keys: [...already], updatedAt: new Date().toISOString() }, null, 2));
  }
  console.log(`[reminders] planned ${planned.length}, sent ${recorded.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
