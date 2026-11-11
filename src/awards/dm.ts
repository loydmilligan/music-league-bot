import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WhatsAppMessage } from '../bot/handler.js';
import { parseAwardCommand, type AwardCmd } from './commands.js';
import { matchForward, type Match } from './match.js';
import { buildCaption } from './caption.js';
import { addCandidate, approve, nextApprover, pick } from './model.js';
import { fillPrompt } from './prompt.js';
import { currentRound, dayAt, windowStartFor, type RoundInfo } from './schedule.js';
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
  sendImage(to: string, file: string, caption: string): Promise<void>;
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
  const matches = matchForward(deps.db, fw.text, deps.groupName, windowStartFor(def, round, deps.now()));
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
  if (res.complete && (changed || !next.decidedAt)) next = { ...next, decidedAt: deps.now().toISOString() };
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


const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' });
function formatDay(d: Date): string {
  const p = Object.fromEntries(dayFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** The 08:00 LA instant this award will post: its scheduled day, or the next 08:00 if that has passed. */
function postInstant(c: AwardCtx): Date {
  const scheduled = dayAt(c.round.releasedAt, c.def.day);
  const now = c.deps.now();
  return scheduled.getTime() > now.getTime() ? scheduled : dayAt(now.toISOString(), 1);
}

const chatId = (id: string): string => (id.includes('@') ? id : `${id.replace(/\D/g, '')}@c.us`);
const nameOf = (config: AwardsConfig, id: string): string => config.names?.[id] ?? id.replace(/@.*$/, '');
const decided = (r: AwardRound): boolean => r.picks[1] !== undefined && r.picks[2] !== undefined && r.picks[3] !== undefined;

function slugFor(db: Database.Database, roundId: number): string | null {
  const row = db.prepare('SELECT slug FROM digest2_shares WHERE round_id = ?').get(roundId) as { slug: string | null } | undefined;
  return row?.slug || null;
}

/** Send the approval preview (poster, caption, then the approve line) to one approver. */
async function sendPreview(c: AwardCtx, r: AwardRound, to: string): Promise<void> {
  const slug = slugFor(c.deps.db, c.round.roundId);
  if (!slug || !r.poster) return;
  const base = c.config.digestBaseUrl.replace(/\/+$/, '');
  const caption = buildCaption(c.def, r, {
    award: `${base}/d2/${slug}/?view=awards&src=award#award-${c.def.key}`,
    recap: "(added at post time if it's built)",
    digest: `${base}/d2/${slug}/?src=award`,
  });
  const target = chatId(to);
  await c.deps.sendImage(target, r.poster, caption);
  await c.deps.sendText(target, `Reply "approve" to post this at 08:00 on ${formatDay(postInstant(c))}.`);
}

async function handlePoster(c: AwardCtx): Promise<void> {
  const { msg, deps, def, round } = c;
  const before = deps.store.get(def.key, round.roundId);
  if (!decided(before)) return c.reply('Pick all three places first.');
  if (!slugFor(deps.db, round.roundId)) return c.reply("This round's digest isn't published yet.");
  const media = (await msg.downloadMedia?.()) ?? null;
  if (!media) return c.reply("Couldn't read that image. Send it again with the caption " + `"${def.prefix} poster".`);
  const file = await deps.savePoster(def.key, round.roundId, media);
  let next: AwardRound = { ...before, poster: file };
  const reset = before.approvals.length > 0 || !!before.approvedAt;
  if (reset) {
    const { approvedAt: _a, ...rest } = next;
    next = { ...rest, approvals: [] };
  }
  deps.store.put(next);
  const first = nextApprover(def, next);
  await c.reply(`Poster saved. Preview sent to ${first ? nameOf(c.config, first) : 'the approver'}.${reset ? ' Approval was reset.' : ''}`);
  if (first) await sendPreview(c, next, first);
}

async function handleApprove(c: AwardCtx, approver: string): Promise<void> {
  const { deps, config, def, round } = c;
  const before = deps.store.get(def.key, round.roundId);
  const turn = nextApprover(def, before);
  const mine = turn !== null && (await deps.isPerson(approver, [turn]));
  const res = approve(def, before, mine ? turn : `not:${approver}`);
  if (res.error === 'not-decided') return c.reply('Pick all three places first.');
  if (res.error === 'no-poster') return c.reply(`Send the poster first, with the caption "${def.prefix} poster".`);
  if (res.error) return c.reply(`It's ${nameOf(config, turn ?? '')}'s turn to approve first.`);
  let next = res.round;
  if (res.done && next.approvedAt && next.approvedAt !== before.approvedAt) next = { ...next, approvedAt: deps.now().toISOString() };
  deps.store.put(next);
  if (res.done) return c.reply(`Approved. Posting ${formatDay(postInstant(c))} at 08:00.`);
  const following = nextApprover(def, next)!;
  await sendPreview(c, next, following);
  return c.reply(`Approved. Waiting on ${nameOf(config, following)}.`);
}

/** Owner DM handler for awards. True = handled; false = fall through to the next handler. */
export async function handleAwardDm(msg: WhatsAppMessage, deps: AwardDmDeps): Promise<boolean> {
  let acked = false;
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
    if (!cmd) return false;

    const reply = (text: string) => deps.sendText(msg.from, text);
    const ack = async () => {
      acked = true;
      try { await msg.react?.('👍'); } catch { /* best effort */ }
    };

    if (cmd.kind === 'approve') {
      // Gated by the approver list, not the owner list.
      let def: AwardDef | undefined;
      if (cmd.award !== null) {
        def = config.awards.find((a) => a.prefix.toLowerCase() === cmd.award);
        if (!def || !(await approverOf(deps, author, def))) return false;
      }
      const round = currentRound(deps.db, config.leagueId, deps.now());
      if (!def) {
        if (!round) return false;
        const mine: AwardDef[] = [];
        for (const d of config.awards) {
          const r = deps.store.get(d.key, round.roundId);
          const next = nextApprover(d, r);
          if (r.poster && next !== null && (await deps.isPerson(author, [next]))) mine.push(d);
        }
        if (mine.length === 0) return false;
        if (mine.length > 1) {
          await ack();
          await reply(`Which one? Send ${mine.map((d) => `"${d.prefix} approve"`).join(' or ')}.`);
          return true;
        }
        def = mine[0];
      }
      await ack();
      if (!round) {
        await reply('No released round yet; nothing to approve.');
        return true;
      }
      await handleApprove({ msg, deps, config, def, round, reply }, author);
      return true;
    }

    const def = config.awards.find((a) => a.prefix.toLowerCase() === cmd.award);
    if (!def || !(await deps.isPerson(author, def.owners))) return false;
    const round = currentRound(deps.db, config.leagueId, deps.now());
    if (cmd.kind === 'poster' && !(msg.hasMedia && msg.downloadMedia)) return false;
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
      case 'poster': await handlePoster(ctx); break;
    }
    return true;
  } catch (err) {
    deps.log(`[awards] dm failed: ${err instanceof Error ? err.name : 'error'}`);
    return acked;
  }
}

async function approverOf(deps: AwardDmDeps, author: string, def: AwardDef): Promise<boolean> {
  for (const a of def.approvers) if (await deps.isPerson(author, [a])) return true;
  return false;
}
