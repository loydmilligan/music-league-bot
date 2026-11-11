import type Database from 'better-sqlite3';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WhatsAppMessage } from '../bot/handler.js';
import { parseAwardCommand, type AwardCmd } from './commands.js';
import { matchForward, type Match } from './match.js';
import { awardLinks, buildCaption } from './caption.js';
import { addCandidate, approve, chatId, nextApprover, pick, postedOk } from './model.js';
import { fillPrompt } from './prompt.js';
import { buildKitZip } from './kit.js';
import type { GeneratePoster } from './generate.js';
import { dayAt, postAtFor, targetRound, windowStartFor, type RoundInfo } from './schedule.js';
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
  /** Send a file as a document (the poster kit zip). */
  sendFile(to: string, file: string, caption: string): Promise<void>;
  savePoster(award: string, roundId: number, media: { mimetype: string; data: string }): Promise<string>;
  /** Make a poster with an image model (prompt + reference image files). Absent = no generation. */
  generatePoster?: GeneratePoster;
  log(l: string): void;
}

const FORWARD_TTL_MS = 120_000;
const generating = new Set<string>();

/**
 * Test mode: an award's admin (an approver or posterMaker who is not an owner) runs the whole flow
 * as owner, approver and maker on a separate `<key>-test` record. Nothing posts to a group, the
 * digest never shows it (no sentAt), and the real owner's record is untouched.
 */
const testFile = (deps: AwardDmDeps) => path.join(deps.storeDir, 'testmode.json');
function testers(deps: AwardDmDeps): Record<string, string[]> {
  try { return JSON.parse(readFileSync(testFile(deps), 'utf8')) as Record<string, string[]>; } catch { return {}; }
}
function setTester(deps: AwardDmDeps, key: string, author: string, on: boolean): void {
  const t = testers(deps);
  const list = (t[key] ?? []).filter((x) => x !== author);
  t[key] = on ? [...list, author] : list;
  writeFileSync(testFile(deps), JSON.stringify(t), { mode: 0o600 });
}
const testing = (deps: AwardDmDeps, key: string, author: string): boolean => (testers(deps)[key] ?? []).includes(author);
function testDef(def: AwardDef, author: string): AwardDef {
  return { ...def, key: `${def.key}-test`, name: `${def.name} (TEST)`, owners: [author], approvers: [author], posterMaker: author, autoFlag: false };
}
async function isAdmin(deps: AwardDmDeps, author: string, def: AwardDef): Promise<boolean> {
  if (await deps.isPerson(author, def.owners)) return false;
  return deps.isPerson(author, [...def.approvers, ...(def.posterMaker ? [def.posterMaker] : [])]);
}
const forwards = new Map<string, { text: string; at: number }>();
const pending = new Map<string, { matches: Match[]; at: number }>();

/** Test hook: forget remembered forwards and pending choices. */
export function resetAwardDmState(): void {
  forwards.clear();
  pending.clear();
  generating.clear();
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
  if (postedOk(r)) return c.reply(alreadyPosted(def));
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
  if (postedOk(before)) return c.reply(alreadyPosted(def));
  const res = pick(before, cmd.place, cmd.n);
  if (res.error) return c.reply(`There's no #${cmd.n}; the list has ${before.candidates.length}.`);
  let next: AwardRound = res.round;
  const changed = JSON.stringify(before.picks) !== JSON.stringify(next.picks);
  let reset = false;
  let clearedPoster = false;
  if (changed) {
    const hadApproval = before.approvals.length > 0 || !!before.approvedAt;
    if (hadApproval || before.poster) {
      const { approvedAt: _a, poster: _p, ...rest } = next;
      next = { ...rest, approvals: [] };
      reset = hadApproval;
      clearedPoster = !!before.poster;
    }
  }
  if (res.complete && (changed || !next.decidedAt)) next = { ...next, decidedAt: deps.now().toISOString() };
  deps.store.put(next);

  const cand = next.candidates.find((x) => x.n === cmd.n)!;
  let text = `${PLACE_NAME[cmd.place]} place: #${cand.n} ${cand.who}, "${clip(cand.text, 80)}"`;
  if (res.cleared) text += ` (${PLACE_NAME[res.cleared]} place is now empty.)`;
  if (clearedPoster) text += reset ? ' Approval was reset; send a new poster.' : ' Send a new poster.';
  else if (reset) text += ' Approval was reset.';
  await c.reply(text);

  if (!res.complete) return;
  const { promptMsg, avatarList, medals } = buildPrompt(c, next);
  const note = def.posterPendingNote ?? "Your poster is being made. You'll receive the draft poster here when it's ready.";
  if (def.genModel && deps.generatePoster) {
    await c.reply(`${def.name} is decided! ${medals}. ${note}`);
    if (await generate(c, null)) return;
    if (!def.posterMaker) {
      await c.reply(`Couldn't make the poster automatically. Prompt below; attach: ${avatarList.join(', ')}.`);
      await c.reply(promptMsg);
      await sendKit(c, next, promptMsg, avatarList);
      return;
    }
    await handOff(c, next, `Couldn't make the ${def.name} poster automatically.`);
    return;
  }
  if (def.posterMaker) {
    await c.reply(`${def.name} is decided! ${medals}. ${note}`);
    const to = chatId(def.posterMaker);
    await deps.sendText(to, `${def.name} is decided! ${medals}. Make the poster, then send it with the caption "${def.prefix} poster". Prompt below; attach: ${avatarList.join(', ')}.`);
    await deps.sendText(to, promptMsg);
    await sendKit(c, next, promptMsg, avatarList, to);
    return;
  }
  await c.reply(`${def.name} is decided! ${medals}. Ready to design the poster. Prompt below; attach: ${avatarList.join(', ')}.`);
  await c.reply(promptMsg);
  await sendKit(c, next, promptMsg, avatarList);
}

function buildPrompt(c: AwardCtx, r: AwardRound): { promptMsg: string; avatarList: string[]; medals: string } {
  const { deps, config, def } = c;
  const picks = ([1, 2, 3] as const).map((p) => r.candidates.find((x) => x.n === r.picks[p])!);
  const medals = picks.map((p, i) => `${MEDAL[(i + 1) as 1 | 2 | 3]} ${p.who}`).join(' ');
  let avatarList = picks.map((p) => avatarFor(config, p.who));
  try {
    const tpl = readFileSync(path.join(deps.storeDir, 'kits', def.promptTemplate), 'utf8');
    const filled = fillPrompt(tpl, def, picks, (w) => avatarFor(config, w));
    avatarList = filled.avatars;
    return { promptMsg: filled.prompt, avatarList, medals };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log(`[awards] prompt build failed for ${def.key}: ${reason}`);
    return { promptMsg: `Couldn't build the poster prompt: ${reason}`, avatarList, medals };
  }
}

/** Zip the prompt, style reference and faces and DM it to the sender. Never throws. */
async function sendKit(c: AwardCtx, r: AwardRound, prompt: string, avatars: string[], to?: string): Promise<void> {
  const { deps, def } = c;
  try {
    const kitsDir = path.join(deps.storeDir, 'kits');
    const { zip, missing } = buildKitZip({ kitsDir, def, prompt, avatars });
    const outDir = path.join(deps.storeDir, 'kits-out');
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${r.roundId}-${def.key}-kit.zip`);
    writeFileSync(file, zip, { mode: 0o600 });
    const caption = `${def.name} poster kit: prompt, style reference and faces.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}`;
    await deps.sendFile(to ?? c.msg.from, file, caption);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log(`[awards] kit send failed for ${def.key}: ${err instanceof Error ? err.name : 'error'}`);
    await c.reply(`Couldn't send the poster kit: ${reason}`);
  }
}

/** Send the prompt and kit to the posterMaker so they can make the poster by hand. */
async function handOff(c: AwardCtx, r: AwardRound, why: string): Promise<void> {
  const { deps, def } = c;
  if (!def.posterMaker) return;
  const { promptMsg, avatarList, medals } = buildPrompt(c, r);
  const to = chatId(def.posterMaker);
  await deps.sendText(to, `${why} ${medals}. Make the poster, then send it with the caption "${def.prefix} poster". Prompt below; attach: ${avatarList.join(', ')}.`);
  await deps.sendText(to, promptMsg);
  await sendKit(c, r, promptMsg, avatarList, to);
}

/**
 * Make the poster with the image model, save it, reset approvals and send the preview.
 * True = handled (made, or already in progress, or the round moved on); false = generation failed.
 */
async function generate(c: AwardCtx, comment: string | null): Promise<boolean> {
  const { deps, def, round } = c;
  if (!def.genModel || !deps.generatePoster) return false;
  const key = `${def.key}|${round.roundId}`;
  if (generating.has(key)) {
    await c.reply('Already making a poster; hang on.');
    return true;
  }
  generating.add(key);
  try {
    const r0 = deps.store.get(def.key, round.roundId);
    if (!decided(r0)) return true;
    const kitsDir = path.join(deps.storeDir, 'kits');
    const tpl = readFileSync(path.join(kitsDir, def.promptTemplate), 'utf8');
    const picks = ([1, 2, 3] as const).map((p) => r0.candidates.find((x) => x.n === r0.picks[p])!);
    const { prompt: base, avatars } = fillPrompt(tpl, def, picks, (w) => avatarFor(c.config, w));
    // The brief lists its images as style reference, then the LEFT (2nd), CENTER (1st), RIGHT (3rd) faces.
    const files = [path.join(kitsDir, `${def.key}-style-reference.png`), ...[avatars[1], avatars[0], avatars[2]].map((a) => path.join(kitsDir, 'avatars', a))];
    const prompt = comment ? `${base}\n\n## Changes requested\n\n${comment}\n\nKeep everything else as the brief says.` : base;
    const media = await deps.generatePoster(def.genModel, prompt, files);
    const file = await deps.savePoster(def.key, round.roundId, media);
    // Re-read after the awaits; drop the poster if the picks changed or the round posted meanwhile.
    const fresh = deps.store.get(def.key, round.roundId);
    if (postedOk(fresh) || !decided(fresh) || JSON.stringify(fresh.picks) !== JSON.stringify(r0.picks)) return true;
    const { approvedAt: _a, ...rest } = fresh;
    const next: AwardRound = { ...rest, poster: file, approvals: [] };
    deps.store.put(next);
    const first = nextApprover(def, next);
    if (!slugFor(deps.db, round.roundId)) {
      await c.reply("The poster is ready, but this round's digest isn't published yet, so there's nothing to preview.");
      return true;
    }
    if (first) await sendPreview(c, next, first);
    const left = Math.max(0, (def.ownerRegens ?? 2) - (next.regens ?? 0));
    const hint = left > 0
      ? `Want changes? Send "${def.prefix} redo" and what to change, e.g. "${def.prefix} redo make the smoke thicker". ${left} redo${left === 1 ? '' : 's'} left.`
      : `Want changes? Send "${def.prefix} redo" and what to change; ${def.posterMaker ? nameOf(c.config, def.posterMaker) : 'the admin'} has to OK it.`;
    for (const o of def.owners) await deps.sendText(chatId(o), hint);
    return true;
  } catch (err) {
    deps.log(`[awards] generate failed for ${def.key}: ${err instanceof Error ? err.message : 'error'}`);
    return false;
  } finally {
    generating.delete(key);
  }
}

async function handleRedo(c: AwardCtx, cmd: AwardCmd & { kind: 'redo' }): Promise<void> {
  const { msg, deps, config, def, round } = c;
  if (!def.genModel || !deps.generatePoster) return c.reply('Poster redos are not set up for this award.');
  const r = deps.store.get(def.key, round.roundId);
  if (postedOk(r)) return c.reply(alreadyPosted(def));
  if (!decided(r)) return c.reply('Pick all three places first.');
  const author = msg.author || msg.from;
  const isOwner = await deps.isPerson(author, def.owners);
  const isMaker = !!def.posterMaker && (await deps.isPerson(author, [def.posterMaker]));

  if (isMaker && (!isOwner || (cmd.comment?.toLowerCase() === 'ok' && r.redoRequest))) {
    let comment = cmd.comment;
    if (comment?.toLowerCase() === 'ok') {
      if (!r.redoRequest) return c.reply('No redo is waiting for your OK.');
      comment = r.redoRequest.comment;
      const { redoRequest: _q, ...rest } = r;
      deps.store.put(rest);
      for (const o of def.owners) await deps.sendText(chatId(o), `${nameOf(config, def.posterMaker!)} OK'd your redo. Making a new poster…`);
    }
    await c.reply('Making a new poster…');
    if (!(await generate(c, comment))) await c.reply("Couldn't make the poster. Try again, or send one with the caption " + `"${def.prefix} poster".`);
    return;
  }

  const limit = def.ownerRegens ?? 2;
  const used = r.regens ?? 0;
  if (r.poster && used >= limit) {
    deps.store.put({ ...r, redoRequest: { comment: cmd.comment, at: deps.now().toISOString() } });
    const maker = def.posterMaker ? nameOf(config, def.posterMaker) : null;
    if (def.posterMaker) {
      await deps.sendText(chatId(def.posterMaker), `${nameOf(config, def.owners[0] ?? author)} wants another ${def.name} redo: "${cmd.comment ?? '(no comment)'}". Reply "${def.prefix} redo ok" to allow it.`);
    }
    return c.reply(`You've used your ${limit} redos. I've asked ${maker ?? 'the admin'} to OK this one.`);
  }
  const counted = !!r.poster;
  if (counted) deps.store.put({ ...r, regens: used + 1 });
  await c.reply('Making a new poster…');
  if (await generate(c, cmd.comment)) return;
  if (counted) deps.store.put({ ...deps.store.get(def.key, round.roundId), regens: used });
  await c.reply("Couldn't make the poster. That one didn't count; try again in a minute.");
}

async function handleKit(c: AwardCtx): Promise<void> {
  const r = c.deps.store.get(c.def.key, c.round.roundId);
  if (!decided(r)) return c.reply('Pick all three places first.');
  const { promptMsg, avatarList } = buildPrompt(c, r);
  await sendKit(c, r, promptMsg, avatarList);
}

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' });
function formatDay(d: Date): string {
  const p = Object.fromEntries(dayFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day}`;
}

/**
 * The 08:00 LA instant this award would post if approved now (R14): its scheduled day, or the next
 * 08:00 if that has passed; null when that is past the next day's 08:00 (too late this round).
 */
function postInstant(c: AwardCtx): Date | null {
  const now = c.deps.now().toISOString();
  return c.round.releasedAt ? postAtFor(c.round.releasedAt, c.def.day, now) : dayAt(now, 1);
}

const alreadyPosted = (def: AwardDef): string => `That round's ${def.name} already posted.`;
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
  const caption = buildCaption(c.def, r, {
    ...awardLinks(c.config, c.def, slug),
    recap: "(added at post time if it's built)",
  });
  const target = chatId(to);
  await c.deps.sendImage(target, r.poster, caption);
  const when = postInstant(c);
  await c.deps.sendText(target, when
    ? `Reply "approve" to post this at 08:00 on ${formatDay(when)}.`
    : `It's too late to post this round's ${c.def.name}; approving won't post it.`);
}

async function handlePoster(c: AwardCtx): Promise<void> {
  const { msg, deps, def, round } = c;
  const before = deps.store.get(def.key, round.roundId);
  if (postedOk(before)) return c.reply(alreadyPosted(def));
  if (!decided(before)) return c.reply('Pick all three places first.');
  if (!slugFor(deps.db, round.roundId)) return c.reply("This round's digest isn't published yet.");
  const media = (await msg.downloadMedia?.()) ?? null;
  if (!media) return c.reply("Couldn't read that image. Send it again with the caption " + `"${def.prefix} poster".`);
  if (!media.mimetype.startsWith('image/')) return c.reply(`That's not an image. Send the poster as a photo with the caption ${def.prefix} poster.`);
  const file = await deps.savePoster(def.key, round.roundId, media);
  // Re-read after the awaits; no await between this read and the put.
  const fresh = deps.store.get(def.key, round.roundId);
  if (postedOk(fresh)) return c.reply(alreadyPosted(def));
  if (!decided(fresh)) return c.reply('Pick all three places first.');
  let next: AwardRound = { ...fresh, poster: file };
  const reset = fresh.approvals.length > 0 || !!fresh.approvedAt;
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
  // A failed or missed post is retried by approving again: start the approval chain fresh.
  const fresh = (r: AwardRound): AwardRound => {
    if (!r.postFailed && !r.skipped) return r;
    const { postedAt: _p, postFailed: _f, skipped: _s, approvedAt: _a, ...rest } = r;
    return { ...rest, approvals: [] };
  };
  const raw = deps.store.get(def.key, round.roundId);
  if (postedOk(raw)) return c.reply(alreadyPosted(def));
  const seen = fresh(raw);
  const turn = nextApprover(def, seen);
  const mine = turn !== null && (await deps.isPerson(approver, [turn]));
  // Re-read after the await; no await between this read and the put.
  const rawBefore = deps.store.get(def.key, round.roundId);
  if (postedOk(rawBefore)) return c.reply(alreadyPosted(def));
  const before = fresh(rawBefore);
  if (before.poster !== seen.poster) return c.reply('The poster changed while you were approving. Check the new preview and approve again.');
  const res = approve(def, before, mine ? turn : `not:${approver}`);
  if (res.error === 'not-decided') return c.reply('Pick all three places first.');
  if (res.error === 'no-poster') return c.reply(`Send the poster first, with the caption "${def.prefix} poster".`);
  if (res.error) return c.reply(`It's ${nameOf(config, turn ?? '')}'s turn to approve first.`);
  let next = res.round;
  if (res.done && next.approvedAt && next.approvedAt !== before.approvedAt) next = { ...next, approvedAt: deps.now().toISOString() };
  deps.store.put(next);
  if (res.done && def.key.endsWith('-test')) {
    const slug = slugFor(deps.db, round.roundId);
    const caption = slug ? buildCaption(def, next, { ...awardLinks(config, def, slug), recap: null }) : `🏆 ${def.name}`;
    const when = postInstant(c);
    await deps.sendImage(c.msg.from, next.poster!, caption);
    return c.reply(`TEST: approved. That is what the group would get${when ? ` at 08:00 on ${formatDay(when)}` : ''}. Nothing was posted. Send "${def.prefix} test reset" to run it again.`);
  }
  if (res.done) {
    const when = next.approvedAt && round.releasedAt ? postAtFor(round.releasedAt, def.day, next.approvedAt) : postInstant(c);
    return c.reply(when ? `Approved. Posting ${formatDay(when)} at 08:00.` : `Approved, but it's too late to post this round's ${def.name}.`);
  }
  const following = nextApprover(def, next)!;
  await sendPreview(c, next, following);
  return c.reply(`Approved. Waiting on ${nameOf(config, following)}.`);
}

/** Owner DM handler for awards. True = handled; false = fall through to the next handler. */
export async function handleAwardDm(msg: WhatsAppMessage, rawDeps: AwardDmDeps): Promise<boolean> {
  // Configured ids may be bare phone digits: compare them as the same chat ids used for sending.
  const deps: AwardDmDeps = { ...rawDeps, isPerson: (a, ids) => rawDeps.isPerson(a, ids.map(chatId)) };
  let acked = false;
  try {
    if (msg.from.endsWith('@g.us')) return false;
    let config: AwardsConfig;
    try { config = deps.store.config(); } catch { return false; }
    const author = msg.author || msg.from;

    // Forward memory: an owner's text forward is remembered silently.
    if (msg.isForwarded && !msg.hasMedia) {
      const owned: AwardDef[] = [];
      for (const d of config.awards) if (await deps.isPerson(author, d.owners)) owned.push(d);
      if (owned.length === 0) return false;
      forwards.set(msg.author, { text: msg.body, at: deps.now().getTime() });
      const auto = owned.length === 1 && owned[0].autoFlag ? owned[0] : null;
      if (!auto) return true;
      // Auto-flag: the forward itself is the command.
      const reply = (text: string) => deps.sendText(msg.from, text);
      acked = true;
      try { await msg.react?.('👍'); } catch { /* best effort */ }
      const round = targetRound(deps.db, config.leagueId, auto, deps.store.all(), deps.now());
      if (!round) {
        await reply('No released round yet; nothing to add to.');
        return true;
      }
      await handleFlag({ msg, deps, config, def: auto, round, reply }, { award: auto.prefix, kind: 'flag' });
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
        if (def && testing(deps, def.key, author)) def = testDef(def, author);
        if (!def || !(await approverOf(deps, author, def))) return false;
      }
      const all = deps.store.all();
      let round: RoundInfo | null;
      if (!def) {
        const mine: { def: AwardDef; round: RoundInfo }[] = [];
        for (const d0 of config.awards) {
          const d = testing(deps, d0.key, author) ? testDef(d0, author) : d0;
          const t = targetRound(deps.db, config.leagueId, d, all, deps.now());
          if (!t) continue;
          const r = deps.store.get(d.key, t.roundId);
          const next = nextApprover(d, r);
          if (r.poster && next !== null && (await deps.isPerson(author, [next]))) mine.push({ def: d, round: t });
        }
        if (mine.length === 0) return false;
        if (mine.length > 1) {
          await ack();
          await reply(`Which one? Send ${mine.map((m) => `"${m.def.prefix} approve"`).join(' or ')}.`);
          return true;
        }
        def = mine[0].def;
        round = mine[0].round;
      } else {
        round = targetRound(deps.db, config.leagueId, def, all, deps.now());
      }
      await ack();
      if (!round) {
        await reply('No released round yet; nothing to approve.');
        return true;
      }
      await handleApprove({ msg, deps, config, def, round, reply }, author);
      return true;
    }

    const realDef = config.awards.find((a) => a.prefix.toLowerCase() === cmd.award);
    if (!realDef) return false;
    if (cmd.kind === 'test') {
      if (!(await isAdmin(deps, author, realDef))) return false;
      await ack();
      if (cmd.action === 'on' || cmd.action === 'off') {
        setTester(deps, realDef.key, author, cmd.action === 'on');
        await reply(cmd.action === 'on'
          ? `Test mode ON for ${realDef.name}. Your ${realDef.prefix} commands now run a private copy: you pick, get the poster, redo and approve; nothing posts and the real one is untouched. Forward a message, then send "${realDef.prefix}". "${realDef.prefix} test off" to stop.`
          : `Test mode OFF for ${realDef.name}.`);
        return true;
      }
      if (cmd.action === 'reset') {
        const td = testDef(realDef, author);
        const t = targetRound(deps.db, config.leagueId, td, deps.store.all(), deps.now());
        if (t) deps.store.put({ award: td.key, roundId: t.roundId, candidates: [], picks: {}, approvals: [] });
        await reply(`Test copy of ${realDef.name} cleared.`);
        return true;
      }
      await reply(`Test mode is ${testing(deps, realDef.key, author) ? 'ON' : 'OFF'} for ${realDef.name}.`);
      return true;
    }
    const def = testing(deps, realDef.key, author) ? testDef(realDef, author) : realDef;
    const makerCmd = (cmd.kind === 'poster' || cmd.kind === 'kit' || cmd.kind === 'redo') && !!def.posterMaker;
    if (!(await deps.isPerson(author, def.owners)) && !(makerCmd && (await deps.isPerson(author, [def.posterMaker!])))) return false;
    const round = targetRound(deps.db, config.leagueId, def, deps.store.all(), deps.now());
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
      case 'kit': await handleKit(ctx); break;
      case 'redo': await handleRedo(ctx, cmd); break;
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
