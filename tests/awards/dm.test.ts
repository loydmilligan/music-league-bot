import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleAwardDm, resetAwardDmState, type AwardDmDeps } from '../../src/awards/dm.js';
import { openAwardStore } from '../../src/awards/store.js';
import type { AwardsConfig } from '../../src/awards/types.js';

const G = 'Test Group';
const MATT = '15550001@c.us';
const CONOR = '15550002@c.us';
const STRANGER = '15550009@c.us';

let db: Database.Database;
let dir: string;
let sent: { to: string; text: string }[];
let reacts: string[];
let clock: Date;
let n: number;
let deps: AwardDmDeps;

const config: AwardsConfig = {
  postGroup: 'test@g.us', groupName: G, leagueId: 1, digestBaseUrl: 'https://d', recapBaseUrl: 'https://r',
  avatars: { 'Zed Tester': 'zed.png' },
  awards: [
    { key: 'bbb', prefix: 'bbb', name: 'BBB', owners: [MATT], approvers: [MATT], day: 1, window: 'round', promptTemplate: 'bbb.md' },
    { key: 'hba', prefix: 'hba', name: 'Half Baked', owners: [CONOR], approvers: [CONOR, MATT], day: 6, window: 'round', promptTemplate: 'hba.md' },
  ],
};

function chat(sender: string, text: string, ts: string) {
  db.prepare(`INSERT INTO chat_messages (id, platform, group_name, group_key, sender, text, ts, msg_hash, captured_at) VALUES (?, 'wa', ?, ?, ?, ?, ?, ?, ?)`)
    .run(`c${++n}`, G, G, sender, text, ts, `h${n}`, ts);
}

function dm(author: string, body: string, extra: Record<string, unknown> = {}) {
  return { body, from: author, author, chatName: '', fromMe: false, react: async (e: string) => { reacts.push(e); }, ...extra } as never;
}
const fwd = (author: string, body: string) => dm(author, body, { isForwarded: true, hasMedia: false });
const last = () => sent[sent.length - 1]?.text;

beforeEach(() => {
  resetAwardDmState();
  n = 0; sent = []; reacts = [];
  clock = new Date('2026-11-05T20:00:00Z');
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE seasons(id INTEGER PRIMARY KEY, league_id INTEGER, season_number INTEGER, status TEXT);
    CREATE TABLE rounds(id INTEGER PRIMARY KEY, season_id INTEGER, round_number INTEGER, submission_deadline TEXT);
    CREATE TABLE digest2_shares(round_id INTEGER PRIMARY KEY, slug TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, platform TEXT, group_name TEXT, group_key TEXT, sender TEXT, text TEXT, ts TEXT, msg_hash TEXT, captured_at TEXT, sender_handle TEXT, source_path TEXT);
    CREATE TABLE wa_messages (msg_id TEXT PRIMARY KEY, chat_id TEXT, chat_name TEXT, author_id TEXT, author_name TEXT, snippet TEXT, ts TEXT);
    INSERT INTO seasons VALUES (1, 1, 1, 'active');
    INSERT INTO rounds VALUES (7, 1, 1, '2026-11-01T00:00:00Z');
    INSERT INTO digest2_shares VALUES (7, 's', '2026-11-03T20:00:00Z', '2026-11-03T20:00:00Z');
  `);
  dir = mkdtempSync(path.join(tmpdir(), 'awdm-'));
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  mkdirSync(path.join(dir, 'kits'));
  writeFileSync(path.join(dir, 'kits', 'bbb.md'), 'Poster for {{AWARD_NAME}}: {{P1_NAME}} / {{P2_NAME}} / {{P3_NAME}}');
  writeFileSync(path.join(dir, 'kits', 'hba.md'), 'Broken {{NOPE}}');
  const store = openAwardStore(dir);
  deps = {
    store, storeDir: dir, db, groupName: G, now: () => clock,
    isPerson: async (a, ids) => ids.includes(a),
    readReactions: async () => [{ emoji: '😂', who: ['x'] }],
    sendText: async (to, text) => { sent.push({ to, text }); },
    savePoster: async () => 'p.png',
    log: () => {},
  };
});

describe('handleAwardDm', () => {
  it('non-owner bbb: false, no react, no send', async () => {
    expect(await handleAwardDm(dm(STRANGER, 'bbb'), deps)).toBe(false);
    expect(reacts).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('Conor hba works; Conor bbb falls through', async () => {
    chat('Alex Q', 'unique joke about toast number one', '2026-11-04T10:00:00Z');
    expect(await handleAwardDm(fwd(CONOR, 'unique joke about toast number one'), deps)).toBe(true);
    expect(await handleAwardDm(dm(CONOR, 'hba'), deps)).toBe(true);
    expect(last()).toMatch(/^Added to Half Baked candidates: #1 Alex Q, /);
    expect(await handleAwardDm(dm(CONOR, 'bbb'), deps)).toBe(false);
  });

  it('forward from a non-owner falls through; from an owner is silent', async () => {
    expect(await handleAwardDm(fwd(STRANGER, 'hi'), deps)).toBe(false);
    expect(await handleAwardDm(fwd(MATT, 'hi'), deps)).toBe(true);
    expect(sent).toEqual([]);
  });

  it('owner: forward then bbb adds a candidate with reactions', async () => {
    chat('Alex Q', 'unique joke about toast number one', '2026-11-04T03:58:00Z');
    db.prepare(`INSERT INTO wa_messages VALUES ('m1','g@g.us',?,?,?,?,?)`).run(G, '1@c.us', 'Alex Q', 'unique joke about toast number one', '2026-11-04T03:58:00Z');
    await handleAwardDm(fwd(MATT, 'unique joke about toast number one'), deps);
    expect(await handleAwardDm(dm(MATT, 'bbb'), deps)).toBe(true);
    expect(reacts).toEqual(['👍']);
    expect(last()).toBe('Added to BBB candidates: #1 Alex Q, Tue Nov 3 7:58 PM');
    const r = deps.store.get('bbb', 7);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].reactions).toEqual([{ emoji: '😂', who: ['x'] }]);
    await handleAwardDm(fwd(MATT, 'unique joke about toast number one'), deps);
    await handleAwardDm(dm(MATT, 'bbb'), deps);
    expect(last()).toBe('Already a candidate: #1 Alex Q, Tue Nov 3 7:58 PM');
    expect(deps.store.get('bbb', 7).candidates).toHaveLength(1);
  });

  it('no recent forward / stale forward', async () => {
    await handleAwardDm(dm(MATT, 'bbb'), deps);
    expect(last()).toBe('Forward me the message first, then send bbb within 2 minutes.');
    await handleAwardDm(fwd(MATT, 'x'), deps);
    clock = new Date(clock.getTime() + 3 * 60_000);
    await handleAwardDm(dm(MATT, 'bbb'), deps);
    expect(last()).toBe('Forward me the message first, then send bbb within 2 minutes.');
  });

  it('not found adds nothing', async () => {
    await handleAwardDm(fwd(MATT, 'nothing like this'), deps);
    await handleAwardDm(dm(MATT, 'bbb'), deps);
    expect(last()).toBe("Couldn't find that message in the group chat this round.");
    expect(deps.store.get('bbb', 7).candidates).toHaveLength(0);
  });

  it('ambiguous lists matches, then bbb 2 adds the second', async () => {
    chat('Alex Q', 'lol', '2026-11-04T03:58:00Z');
    chat('Bo Z', 'lol', '2026-11-04T04:10:00Z');
    await handleAwardDm(fwd(MATT, 'lol'), deps);
    await handleAwardDm(dm(MATT, 'bbb'), deps);
    expect(last()).toBe('That text appears 2 times. Send bbb 1…bbb 2 to choose:\n1. Alex Q, Tue Nov 3 7:58 PM\n2. Bo Z, Tue Nov 3 8:10 PM');
    expect(deps.store.get('bbb', 7).candidates).toHaveLength(0);
    await handleAwardDm(dm(MATT, 'bbb 2'), deps);
    expect(last()).toBe('Added to BBB candidates: #1 Bo Z, Tue Nov 3 8:10 PM');
    await handleAwardDm(dm(MATT, 'bbb 9'), deps);
    expect(deps.store.get('bbb', 7).candidates).toHaveLength(1);
  });

  it('list output', async () => {
    await handleAwardDm(dm(MATT, 'bbb candidates'), deps);
    expect(last()).toBe('No BBB candidates yet.');
    chat('Alex Q', 'a joke', '2026-11-04T03:58:00Z');
    await handleAwardDm(fwd(MATT, 'a joke'), deps);
    await handleAwardDm(dm(MATT, 'bbb'), deps);
    await handleAwardDm(dm(MATT, 'bbb candidates'), deps);
    expect(last()).toBe('BBB candidates this round:\n1. Alex Q (Tue Nov 3 7:58 PM): a joke');
  });

  async function seed(k: number) {
    for (let i = 1; i <= k; i++) {
      const name = i === 1 ? 'Zed Tester' : `P${i} Person`;
      chat(name, `joke number ${i} is here`, `2026-11-04T0${i}:00:00Z`);
      await handleAwardDm(fwd(MATT, `joke number ${i} is here`), deps);
      await handleAwardDm(dm(MATT, 'bbb'), deps);
    }
  }

  it('bad numbers leave state unchanged (0, 9)', async () => {
    await seed(2);
    sent = []; reacts = [];
    const before = JSON.stringify(deps.store.get('bbb', 7));
    await handleAwardDm(dm(MATT, 'bbb-1 9'), deps);
    expect(last()).toBe("There's no #9; the list has 2.");
    await handleAwardDm(dm(MATT, 'bbb-1 0'), deps);
    expect(last()).toBe("There's no #0; the list has 2.");
    expect(JSON.stringify(deps.store.get('bbb', 7))).toBe(before);
    expect(reacts).toEqual(['👍', '👍']);
  });

  it('full picks: confirmations, decided message, prompt', async () => {
    await seed(3);
    sent = [];
    await handleAwardDm(dm(MATT, 'bbb-1 1'), deps);
    expect(last()).toBe('First place: #1 Zed Tester, "joke number 1 is here"');
    await handleAwardDm(dm(MATT, 'bbb-2 2'), deps);
    sent = [];
    await handleAwardDm(dm(MATT, 'bbb-3 3'), deps);
    expect(sent.map((s) => s.text)).toEqual([
      'Third place: #3 P3 Person, "joke number 3 is here"',
      'BBB is decided! 🥇 Zed Tester 🥈 P2 Person 🥉 P3 Person. Ready to design the poster. Prompt below; attach: zed.png, p2-person.png, p3-person.png.',
      'Poster for BBB: Zed Tester / P2 Person / P3 Person',
    ]);
    expect(deps.store.get('bbb', 7).decidedAt).toBeTruthy();
  });

  it('moving a pick reports the cleared place; changed pick resets approvals', async () => {
    await seed(3);
    await handleAwardDm(dm(MATT, 'bbb-1 1'), deps);
    await handleAwardDm(dm(MATT, 'bbb-2 2'), deps);
    await handleAwardDm(dm(MATT, 'bbb-2 1'), deps);
    expect(last()).toBe('Second place: #1 Zed Tester, "joke number 1 is here" (First place is now empty.)');
    const r = deps.store.get('bbb', 7);
    deps.store.put({ ...r, approvals: [MATT], approvedAt: '2026-11-05T00:00:00Z' });
    await handleAwardDm(dm(MATT, 'bbb-3 3'), deps);
    expect(last()).toMatch(/ Approval was reset\.$/);
    const r2 = deps.store.get('bbb', 7);
    expect(r2.approvals).toEqual([]);
    expect(r2.approvedAt).toBeUndefined();
  });

  it('missing kit or bad template: decided message still sent, prompt message explains', async () => {
    // hba template has an unknown field
    for (let i = 1; i <= 3; i++) {
      chat(`Q${i} X`, `hba joke ${i} text`, `2026-11-04T0${i}:00:00Z`);
      await handleAwardDm(fwd(CONOR, `hba joke ${i} text`), deps);
      await handleAwardDm(dm(CONOR, 'hba'), deps);
    }
    for (const p of [1, 2, 3]) await handleAwardDm(dm(CONOR, `hba-${p} ${p}`), deps);
    const t = sent.slice(-2).map((s) => s.text);
    expect(t[0]).toMatch(/^Half Baked is decided!/);
    expect(t[1]).toMatch(/^Couldn't build the poster prompt: /);
  });

  it('no released round', async () => {
    db.exec('DELETE FROM digest2_shares');
    await handleAwardDm(dm(MATT, 'bbb'), deps);
    expect(last()).toBe('No released round yet; nothing to add to.');
  });

  it('poster and approve fall through', async () => {
    expect(await handleAwardDm(dm(MATT, 'bbb poster'), deps)).toBe(false);
    expect(await handleAwardDm(dm(MATT, 'approve'), deps)).toBe(false);
  });
});
