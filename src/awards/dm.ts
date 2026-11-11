import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WhatsAppMessage } from '../bot/handler.js';
import { parseAwardCommand, type AwardCmd } from './commands.js';
import { matchForward, type Match } from './match.js';
import { addCandidate, pick } from './model.js';
import { fillPrompt } from './prompt.js';
import { currentRound, windowStartFor, type RoundInfo } from './schedule.js';
import type { AwardStore } from './store.js';
import type { AwardDef, AwardRound, AwardsConfig, Candidate } from './types.js';

export interface AwardDmDeps {
  store: AwardStore;
  /** Award store directory; kit templates live in `<storeDir>/kits/`. */
  storeDir: string;
  db: Database.Database;
  isPerson(author: string, ids: string[]): Promise<boolean>;
  groupName: string;
  now(): Date;
  readReactions(msgId: string): Promise<{ emoji: string; who: string[] }[] | null>;
  sendText(to: string, text: string): Promise<void>;
  savePoster(award: string, roundId: number, media: { mimetype: string; data: string }): Promise<string>;
  log(l: string): void;
}

const FORWARD_TTL_MS = 120_000;
const forwards = new Map<string, { text: string; at: number }>();
const pending = new Map<string, { matches: Match[]; at: number }>();

/** Test hook: forget remembered forwards and pending choices. */
export function resetAwardDmState(): void {
  forwards.clear();
  pending.clear();
}

const PLACE_NAME = { 1: 'First', 2: 'Second', 3: 'Third' } as const;
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' } as const;

const whenFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
});
export function formatWhen(ts: string): string {
  const p = Object.fromEntries(whenFmt.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

export const avatarFor = (config: AwardsConfig, who: string): string =>
  config.avatars?.[who] ?? `${who.toLowerCase().replace(/\s+/g, '-')}.png`;

/** What a command handler needs; Task 6 handlers take the same shape. */
export interface AwardCtx {
  msg: WhatsAppMessage;
  deps: AwardDmDeps;
  config: AwardsConfig;
  def: AwardDef;
  round: RoundInfo;
  reply(text: string): Promise<void>;
}

async function handleFlag(c: AwardCtx, cmd: AwardCmd & { kind: 'flag' }): Promise<void> {
  const { msg, deps, config, def, round } = c;
  const fw = forwards.get(msg.author);
  if (!fw || deps.now().getTime() - fw.at > FORWARD_TTL_MS) {
    return c.reply(`Forward me the message first, then send ${def.prefix} within 2 minutes.`);
  }
  const matches = matchForward(deps.db, fw.text, config.groupName, windowStartFor(def, round, deps.now()));
  if (matches.length === 0) return c.reply("Couldn't find that message in the group chat this round.");
  if (matches.length > 1) {
    pending.set(`${msg.author}|${def.prefix}`, { matches, at: fw.at });
    const lines = matches.map((m, i) => `${i + 1}. ${m.who}, ${formatWhen(m.ts)}`);
    return c.reply([`That text appears ${matches.length} times. Send ${def.prefix} 1…${def.prefix} ${matches.length} to choose:`, ...lines].join('\n'));
  }
  void cmd;
  return addMatch(c, matches[0]);
}

async function addMatch(c: AwardCtx, m: Match): Promise<void> {
  const { deps, def, round } = c;
  let reactions: Candidate['reactions'] = null;
  if (m.msgId) {
    try { reactions = await deps.readReactions(m.msgId); } catch { reactions = null; }
  }
  const r = deps.store.get(def.key, round.roundId);
  const added = addCandidate(r, { who: m.who, authorId: m.authorId, text: m.text, ts: m.ts, msgId: m.msgId, reactions });
  if (added.duplicate) return c.reply(`Already a candidate: #${added.n} ${m.who}, ${formatWhen(m.ts)}`);
  deps.store.put(added.round);
  return c.reply(`Added to ${def.name} candidates: #${added.n} ${m.who}, ${formatWhen(m.ts)}`);
}

async function handleChoose(c: AwardCtx, cmd: AwardCmd & { kind: 'choose' }): Promise<void> {
  const { msg, deps, def } = c;
  const key = `${msg.author}|${def.prefix}`;
  const p = pending.get(key);
  if (!p || deps.now().getTime() - p.at > FORWARD_TTL_MS) {
    return c.reply(`Nothing to choose from. Forward me the message first, then send ${def.prefix}.`);
  }
  const m = p.matches[cmd.n - 1];
  if (!m) return c.reply(`There's no #${cmd.n}; the list has ${p.matches.length}.`);
  pending.delete(key);
  return addMatch(c, m);
}

async function handleList(c: AwardCtx): Promise<void> {
  const { deps, def, round } = c;
  const r = deps.store.get(def.key, round.roundId);
  if (r.candidates.length === 0) return c.reply(`No ${def.name} candidates yet.`);
  const lines = r.candidates.map((x) => `${x.n}. ${x.who} (${formatWhen(x.ts)}): ${clip(x.text, 160)}`);
  return c.reply([`${def.name} candidates this round:`, ...lines].join('\n'));
}

async function handlePick(c: AwardCtx, cmd: AwardCmd & { kind: 'pick' }): Promise<void> {
  const { deps, config, def, round } = c;
  const before = deps.store.get(def.key, round.roundId);
  const res = pick(before, cmd.place, cmd.n);
  if (res.error) return c.reply(`There's no #${cmd.n}; the list has ${before.candidates.length}.`);
  let next: AwardRound = res.round;
  const changed = JSON.stringify(before.picks) !== JSON.stringify(next.picks);
  let reset = false;
  if (changed && (before.approvals.length > 0 || before.approvedAt)) {
    const { approvedAt: _a, ...rest } = next;
    next = { ...rest, approvals: [] };
    reset = true;
  }
  if (res.complete && !next.decidedAt) next = { ...next, decidedAt: deps.now().toISOString() };
  deps.store.put(next);

  const cand = next.candidates.find((x) => x.n === cmd.n)!;
  let text = `${PLACE_NAME[cmd.place]} place: #${cand.n} ${cand.who}, "${clip(cand.text, 80)}"`;
  if (res.cleared) text += ` (${PLACE_NAME[res.cleared]} place is now empty.)`;
  if (reset) text += ' Approval was reset.';
  await c.reply(text);

  if (!res.complete) return;
  const picks = ([1, 2, 3] as const).map((p) => next.candidates.find((x) => x.n === next.picks[p])!);
  const avatars = picks.map((p) => avatarFor(config, p.who));
  const medals = picks.map((p, i) => `${MEDAL[(i + 1) as 1 | 2 | 3]} ${p.who}`).join(' ');
  let promptMsg: string;
  let avatarList = avatars;
  try {
    const tpl = readFileSync(path.join(deps.storeDir, 'kits', def.promptTemplate), 'utf8');
    const filled = fillPrompt(tpl, def, picks, (w) => avatarFor(config, w));
    promptMsg = filled.prompt;
    avatarList = filled.avatars;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log(`[awards] prompt build failed for ${def.key}: ${reason}`);
    promptMsg = `Couldn't build the poster prompt: ${reason}`;
  }
  await c.reply(`${def.name} is decided! ${medals}. Ready to design the poster. Prompt below; attach: ${avatarList.join(', ')}.`);
  await c.reply(promptMsg);
}

/** Owner DM handler for awards. True = handled; false = fall through to the next handler. */
export async function handleAwardDm(msg: WhatsAppMessage, deps: AwardDmDeps): Promise<boolean> {
  try {
    if (msg.from.endsWith('@g.us')) return false;
    let config: AwardsConfig;
    try { config = deps.store.config(); } catch { return false; }
    const author = msg.author || msg.from;

    // Forward memory: an owner's text forward is remembered silently.
    if (msg.isForwarded && !msg.hasMedia) {
      let owner = false;
      for (const d of config.awards) if (await deps.isPerson(author, d.owners)) { owner = true; break; }
      if (!owner) return false;
      forwards.set(msg.author, { text: msg.body, at: deps.now().getTime() });
      return true;
    }

    const cmd = parseAwardCommand(msg.body, config.awards.map((a) => a.prefix.toLowerCase()));
    if (!cmd || cmd.award === null) return false;
    const def = config.awards.find((a) => a.prefix.toLowerCase() === cmd.award);
    if (!def || !(await deps.isPerson(author, def.owners))) return false;

    // Task 6 owns poster and approve.
    if (cmd.kind === 'poster' || cmd.kind === 'approve') return false;

    const reply = (text: string) => deps.sendText(msg.from, text);
    const ack = async () => {
      try { await msg.react?.('👍'); } catch { /* best effort */ }
    };
    const round = currentRound(deps.db, config.leagueId, deps.now());
    if (!round) {
      await ack();
      await reply('No released round yet; nothing to add to.');
      return true;
    }
    const ctx: AwardCtx = { msg, deps, config, def, round, reply };
    await ack();
    switch (cmd.kind) {
      case 'flag': await handleFlag(ctx, cmd); break;
      case 'choose': await handleChoose(ctx, cmd); break;
      case 'list': await handleList(ctx); break;
      case 'pick': await handlePick(ctx, cmd); break;
    }
    return true;
  } catch (err) {
    deps.log(`[awards] dm failed: ${err instanceof Error ? err.name : 'error'}`);
    return false;
  }
}
