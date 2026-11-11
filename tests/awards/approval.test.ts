import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleAwardDm, resetAwardDmState, type AwardDmDeps } from '../../src/awards/dm.js';
import { openAwardStore } from '../../src/awards/store.js';
import type { AwardsConfig, Candidate } from '../../src/awards/types.js';

const MATT = '15550001';
const CONOR = '15550002@c.us';
const STRANGER = '15550009@c.us';
const MATT_ID = '15550001@c.us';

let db: Database.Database;
let dir: string;
let sent: { to: string; text: string }[];
let images: { to: string; file: string; caption: string }[];
let reacts: string[];
let saved: { award: string; roundId: number; mimetype: string }[];
let clock: Date;
let deps: AwardDmDeps;

const config: AwardsConfig = {
  postGroup: 'test@g.us', groupName: 'G', leagueId: 1, digestBaseUrl: 'https://d/', recapBaseUrl: 'https://r',
  names: { [MATT]: 'Matt', [CONOR]: 'Conor' },
  awards: [
    { key: 'bbb', prefix: 'bbb', name: 'BBB', owners: [MATT], approvers: [MATT], day: 1, window: 'round', promptTemplate: 'bbb.md' },
    { key: 'hba', prefix: 'hba', name: 'Half Baked', owners: [CONOR], approvers: [CONOR, MATT], day: 6, window: 'round', promptTemplate: 'hba.md' },
  ],
};
const cand = (n: number, who: string): Candidate => ({ n, who, authorId: null, text: `text ${n}`, ts: '2026-11-04T00:00:00Z', msgId: null, reactions: null });

const norm = (s: string) => s.replace('@c.us', '');
function dm(author: string, body: string, extra: Record<string, unknown> = {}) {
  return { body, from: author.includes('@') ? author : `${author}@c.us`, author, chatName: '', fromMe: false, react: async (e: string) => { reacts.push(e); }, ...extra } as never;
}
const img = (author: string, body: string, mimetype = 'image/jpeg') =>
  dm(author, body, { hasMedia: true, downloadMedia: async () => ({ mimetype, data: 'AAAA' }) });
const last = () => sent[sent.length - 1]?.text;

function seed(award: string, extra: Record<string, unknown> = {}) {
  deps.store.put({ award, roundId: 7, candidates: [cand(1, 'Ann'), cand(2, 'Bo'), cand(3, 'Cy')], picks: { 1: 1, 2: 2, 3: 3 }, approvals: [], ...extra } as never);
}

beforeEach(() => {
  resetAwardDmState();
  sent = []; images = []; reacts = []; saved = [];
  // Round 7 released 11-03 20:00Z: BBB day 1 = Wed 11-04 08:00, HBA day 6 = Mon 11-09 08:00.
  clock = new Date('2026-11-04T20:00:00Z');
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
  dir = mkdtempSync(path.join(tmpdir(), 'awap-'));
  const store = openAwardStore(dir);
  store.put({ award: 'x', roundId: 0, candidates: [], picks: {}, approvals: [] }); // ensure dir
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  deps = {
    store, storeDir: dir, db, groupName: 'G', now: () => clock,
    isPerson: async (a, ids) => ids.some((i) => norm(i) === norm(a)),
    readReactions: async () => null,
    sendText: async (to, text) => { sent.push({ to, text }); },
    sendImage: async (to, file, caption) => { images.push({ to, file, caption }); },
    savePoster: async (award, roundId, media) => { saved.push({ award, roundId, mimetype: media.mimetype }); return `/p/${roundId}-${award}.jpg`; },
    log: () => {},
  };
});

describe('poster', () => {
  it('before all three picks: reply, nothing stored', async () => {
    deps.store.put({ award: 'hba', roundId: 7, candidates: [cand(1, 'Ann')], picks: { 1: 1 }, approvals: [] });
    expect(await handleAwardDm(img(CONOR, 'hba poster'), deps)).toBe(true);
    expect(last()).toBe('Pick all three places first.');
    expect(saved).toEqual([]);
    expect(deps.store.get('hba', 7).poster).toBeUndefined();
  });
  it('wrong caption or non-owner falls through', async () => {
    seed('hba');
    expect(await handleAwardDm(img(CONOR, 'nice one'), deps)).toBe(false);
    expect(await handleAwardDm(img(STRANGER, 'hba poster'), deps)).toBe(false);
    expect(saved).toEqual([]);
  });
  it('no published slug: says so, stores nothing', async () => {
    seed('hba');
    db.exec('DELETE FROM digest2_shares');
    // currentRound needs a share; keep one row but blank slug
    db.exec("INSERT INTO digest2_shares VALUES (7, NULL, '2026-11-03T20:00:00Z', '2026-11-03T20:00:00Z')");
    await handleAwardDm(img(CONOR, 'hba poster'), deps);
    expect(last()).toBe("This round's digest isn't published yet.");
    expect(saved).toEqual([]);
  });
  it('saves, sends preview with caption to Conor, then the approve line', async () => {
    seed('hba');
    expect(await handleAwardDm(img(CONOR, 'hba poster', 'image/png'), deps)).toBe(true);
    expect(saved).toEqual([{ award: 'hba', roundId: 7, mimetype: 'image/png' }]);
    expect(deps.store.get('hba', 7).poster).toBe('/p/7-hba.jpg');
    expect(images).toHaveLength(1);
    expect(images[0].to).toBe(CONOR);
    expect(images[0].caption).toBe([
      '🏆 Half Baked', '🥇 Ann · 🥈 Bo · 🥉 Cy',
      '👉 Full award: https://d/d2/s/?view=awards&src=award#award-hba',
      "☀️ This morning's recap: (added at post time if it's built)",
      "📰 This round's digest: https://d/d2/s/?src=award",
    ].join('\n'));
    const toConor = sent.filter((s) => s.to === CONOR).map((s) => s.text);
    expect(toConor).toContain('Reply "approve" to post this at 08:00 on Mon Nov 9.');
  });
  it('a poster for a round that posted meanwhile is refused', async () => {
    seed('bbb', { poster: '/p/old.jpg' });
    deps.savePoster = async () => {
      deps.store.put({ ...deps.store.get('bbb', 7), postedAt: '2026-11-05T16:00:00Z' });
      return '/p/new.jpg';
    };
    await handleAwardDm(img(MATT, 'bbb poster'), deps);
    expect(last()).toBe("That round's BBB already posted.");
    expect(deps.store.get('bbb', 7).poster).toBe('/p/old.jpg');
  });
  it('a new poster after approvals resets them', async () => {
    seed('hba', { poster: '/old.jpg', approvals: [CONOR], approvedAt: '2026-11-05T00:00:00Z' });
    await handleAwardDm(img(CONOR, 'hba poster'), deps);
    const r = deps.store.get('hba', 7);
    expect(r.approvals).toEqual([]);
    expect(r.approvedAt).toBeUndefined();
    expect(sent.some((s) => s.text.endsWith(' Approval was reset.'))).toBe(true);
  });
});

describe('approval chain', () => {
  beforeEach(() => seed('hba', { poster: '/p/7-hba.jpg' }));

  it('Conor approves: preview to Matt, Waiting on Matt', async () => {
    expect(await handleAwardDm(dm(CONOR, 'hba approve'), deps)).toBe(true);
    expect(reacts).toEqual(['👍']);
    expect(deps.store.get('hba', 7).approvals).toEqual([CONOR]);
    expect(deps.store.get('hba', 7).approvedAt).toBeUndefined();
    expect(images.map((i) => i.to)).toEqual([MATT_ID]);
    expect(last()).toBe('Approved. Waiting on Matt.');
  });
  it('Matt (not an owner) approving first is told to wait', async () => {
    expect(await handleAwardDm(dm(MATT, 'hba approve'), deps)).toBe(true);
    expect(last()).toBe("It's Conor's turn to approve first.");
    expect(deps.store.get('hba', 7).approvals).toEqual([]);
  });
  it('full chain sets approvedAt; Matt can use bare approve', async () => {
    await handleAwardDm(dm(CONOR, 'approve'), deps);
    sent = [];
    expect(await handleAwardDm(dm(MATT, 'approve'), deps)).toBe(true);
    const r = deps.store.get('hba', 7);
    expect(r.approvedAt).toBeDefined();
    expect(sent.at(-1)?.text).toBe('Approved. Posting Mon Nov 9 at 08:00.');
  });
  it('late approval names the next 08:00', async () => {
    deps.store.put({ ...deps.store.get('hba', 7), approvals: [CONOR] });
    clock = new Date('2026-11-09T20:00:00Z');
    await handleAwardDm(dm(MATT, 'hba approve'), deps);
    expect(last()).toBe('Approved. Posting Tue Nov 10 at 08:00.');
  });
  it('R14: an approval whose next 08:00 is past the next day says it is too late', async () => {
    // Spring-forward week: released Sun 2027-03-07 noon PST, day 6 = Sat 03-13 08:00 PST (16:00Z),
    // day 7 = Sun 03-14 08:00 PDT (15:00Z). At 15:30Z the round is still targeted (< day 6 + 24h),
    // but the next 08:00 is Mon 03-15.
    db.exec(`UPDATE digest2_shares SET created_at = '2027-03-07T20:00:00Z' WHERE round_id = 7`);
    deps.store.put({ ...deps.store.get('hba', 7), approvals: [CONOR] });
    clock = new Date('2027-03-14T15:30:00Z');
    await handleAwardDm(dm(MATT, 'hba approve'), deps);
    expect(last()).toBe("Approved, but it's too late to post this round's Half Baked.");
  });
  it('approve on a round that posted meanwhile is refused', async () => {
    seed('bbb', { poster: '/p/7-bbb.jpg' });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const realIs = deps.isPerson;
    let calls = 0;
    // Hold the in-handler turn check (2nd call; the 1st is the approver gate before targeting).
    deps.isPerson = async (a, ids) => { if (++calls === 2) await gate; return realIs(a, ids); };
    const approving = handleAwardDm(dm(MATT, 'bbb approve'), deps);
    await new Promise((r) => setTimeout(r, 5));
    deps.store.put({ ...deps.store.get('bbb', 7), approvals: [MATT], approvedAt: 'x', postedAt: '2026-11-05T16:00:00Z', sentAt: '2026-11-05T16:00:02Z' });
    release();
    await approving;
    expect(last()).toBe("That round's BBB already posted.");
    expect(deps.store.get('bbb', 7).sentAt).toBe('2026-11-05T16:00:02Z');
  });
  it('bare approve with two awaiting asks which', async () => {
    seed('bbb', { poster: '/p/7-bbb.jpg' });
    deps.store.put({ ...deps.store.get('hba', 7), approvals: [CONOR] });
    await handleAwardDm(dm(MATT, 'approve'), deps);
    expect(last()).toBe('Which one? Send "bbb approve" or "hba approve".');
  });
  it('bare approve from someone with nothing to approve falls through', async () => {
    expect(await handleAwardDm(dm(STRANGER, 'approve'), deps)).toBe(false);
    expect(reacts).toEqual([]);
    expect(sent).toEqual([]);
  });
  it('explicit approve from a stranger falls through', async () => {
    expect(await handleAwardDm(dm(STRANGER, 'hba approve'), deps)).toBe(false);
  });
});

describe('carried Task 5 minors', () => {
  it('re-pick after a decision refreshes decidedAt', async () => {
    seed('hba', { decidedAt: '2026-11-01T00:00:00Z', candidates: [cand(1, 'Ann'), cand(2, 'Bo'), cand(3, 'Cy'), cand(4, 'Di')] });
    await handleAwardDm(dm(CONOR, 'hba-3 4'), deps);
    expect(deps.store.get('hba', 7).decidedAt).toBe(clock.toISOString());
  });
  it('returns true once acked even if later code throws', async () => {
    seed('hba');
    deps.sendText = async () => { throw new Error('boom'); };
    expect(await handleAwardDm(dm(CONOR, 'hba candidates'), deps)).toBe(true);
  });
});

describe('fix round 1', () => {
  it('approve racing a poster swap cannot approve the new poster', async () => {
    seed('hba', { poster: '/p/old.jpg', approvals: [CONOR] });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const realIs = deps.isPerson;
    deps.isPerson = async (a, ids) => { if (a === MATT) await gate; return realIs(a, ids); };
    const approving = handleAwardDm(dm(MATT, 'hba approve'), deps);
    await new Promise((r) => setTimeout(r, 5));
    deps.savePoster = async () => '/p/new.jpg';
    await handleAwardDm(img(CONOR, 'hba poster'), deps);
    release();
    await approving;
    const r = deps.store.get('hba', 7);
    expect(r.poster).toBe('/p/new.jpg');
    expect(r.approvedAt).toBeUndefined();
    expect(r.approvals).toEqual([]);
  });
  it('a pick change clears the poster too', async () => {
    seed('hba', { poster: '/p/x.jpg', approvals: [CONOR], candidates: [cand(1, 'A'), cand(2, 'B'), cand(3, 'C'), cand(4, 'D')] });
    await handleAwardDm(dm(CONOR, 'hba-3 4'), deps);
    expect(deps.store.get('hba', 7).poster).toBeUndefined();
    expect(sent.some((s) => s.text.includes(' Approval was reset; send a new poster.'))).toBe(true);
  });
  it('non-image mimetype is refused', async () => {
    seed('hba');
    await handleAwardDm(img(CONOR, 'hba poster', 'application/pdf'), deps);
    expect(last()).toBe("That's not an image. Send the poster as a photo with the caption hba poster.");
    expect(saved).toEqual([]);
  });
});

describe('fix round 2', () => {
  it('pick change clears a poster even with no approvals', async () => {
    seed('hba', { poster: '/p/x.jpg', candidates: [cand(1, 'A'), cand(2, 'B'), cand(3, 'C'), cand(4, 'D')] });
    await handleAwardDm(dm(CONOR, 'hba-3 4'), deps);
    expect(deps.store.get('hba', 7).poster).toBeUndefined();
    expect(sent.some((s) => s.text.endsWith(' Send a new poster.'))).toBe(true);
    expect(sent.some((s) => s.text.includes('Approval was reset'))).toBe(false);
  });
  it('picks cleared during savePoster: no poster attached', async () => {
    seed('hba');
    deps.savePoster = async () => { deps.store.put({ ...deps.store.get('hba', 7), picks: { 1: 1 } }); return '/p/n.jpg'; };
    await handleAwardDm(img(CONOR, 'hba poster'), deps);
    expect(last()).toBe('Pick all three places first.');
    expect(deps.store.get('hba', 7).poster).toBeUndefined();
  });
});

describe('re-approve after a failed post', () => {
  it('postFailed clears postedAt and runs the chain fresh', async () => {
    seed('bbb', { poster: '/p.jpg', approvals: [MATT], approvedAt: '2026-11-05T01:00:00Z', postedAt: '2026-11-05T16:00:00Z', postFailed: true });
    expect(await handleAwardDm(dm(MATT_ID, 'bbb approve'), deps)).toBe(true);
    const r = deps.store.get('bbb', 7);
    expect(r.postFailed).toBeUndefined();
    expect(r.postedAt).toBeUndefined();
    expect(r.approvedAt).toBe(clock.toISOString());
    expect(r.approvals).toEqual([MATT]);
  });
  it('a successfully posted round is not re-armed by approve', async () => {
    seed('bbb', { poster: '/p.jpg', approvals: [MATT], approvedAt: '2026-11-05T01:00:00Z', postedAt: '2026-11-05T16:00:00Z' });
    await handleAwardDm(dm(MATT_ID, 'bbb approve'), deps);
    const r = deps.store.get('bbb', 7);
    expect(r.postedAt).toBe('2026-11-05T16:00:00Z');
    expect(r.approvedAt).toBe('2026-11-05T01:00:00Z');
  });
  it('a two-approver award restarts at the first approver', async () => {
    seed('hba', { poster: '/p.jpg', approvals: [CONOR, MATT], approvedAt: '2026-11-05T01:00:00Z', postedAt: '2026-11-05T16:00:00Z', postFailed: true });
    await handleAwardDm(dm(MATT_ID, 'hba approve'), deps);
    expect(last()).toMatch(/Conor's turn/);
    expect(deps.store.get('hba', 7).postFailed).toBe(true); // refused: state unchanged
  });
});
