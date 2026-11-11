import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeRecapUrlFor, startAwardPostTick } from '../../src/awards/postTick.js';
import { openAwardStore, type AwardStore } from '../../src/awards/store.js';
import type { AwardsConfig } from '../../src/awards/types.js';
import { mayPost } from '../../src/whatsapp/noPostGroups.js';

const GROUP = 'test@g.us';
const config: AwardsConfig = {
  postGroup: GROUP, groupName: 'G', leagueId: 1, digestBaseUrl: 'https://d/', recapBaseUrl: 'https://r',
  awards: [
    // Owner '1' (bare digits) is also approver '1@c.us': DMs dedupe to one each for 1 and 3.
    { key: 'bbb', prefix: 'bbb', name: 'BBB', owners: ['1'], approvers: ['1@c.us', '3'], day: 1, window: 'round', promptTemplate: 'bbb.md' },
  ],
};
// Released Tue 2026-11-03 12:00 PST (20:00Z): day 1 = Wed 2026-11-04 08:00 PST = 16:00Z.
const D1_0800 = '2026-11-04T16:00:00.000Z';
const at = (iso: string) => new Date(iso);

let store: AwardStore;
let clock: Date;
let sends: { to: string; file: string; caption: string; mayPostInside: boolean }[];
let dms: string[];
let dmTo: string[];
let republishError: Error | null;
let db: Database.Database;
let republished: number[];
let logs: string[];
let recap: string | null;
let sendError: Error | null;
let dir: string;
let prevData: string | undefined;
let tick: () => Promise<void>;
let stop: () => void;

function seedRound(extra: Record<string, unknown> = {}) {
  store.put({
    award: 'bbb', roundId: 7,
    candidates: [1, 2, 3].map((n) => ({ n, who: `P${n}`, authorId: null, text: `t${n}`, ts: '2026-11-03T00:00:00Z', msgId: null, reactions: null })),
    picks: { 1: 1, 2: 2, 3: 3 }, poster: '/p.jpg', approvals: ['1@c.us', '3'], approvedAt: '2026-11-03T22:00:00Z', ...extra,
  } as never);
}

beforeEach(() => {
  prevData = process.env.DATA_DIR;
  dir = mkdtempSync(path.join(tmpdir(), 'pt-'));
  process.env.DATA_DIR = dir;
  writeFileSync(path.join(dir, 'no-post-groups.json'), JSON.stringify({ groups: [GROUP] }));
  const awardsDir = path.join(dir, 'awards');
  store = openAwardStore(awardsDir);
  store.put({ award: 'x', roundId: 0, candidates: [], picks: {}, approvals: [] });
  writeFileSync(path.join(awardsDir, 'config.json'), JSON.stringify(config));
  db = new Database(':memory:');
  db.exec(`CREATE TABLE digest2_shares(round_id INTEGER PRIMARY KEY, slug TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO digest2_shares VALUES (7, 'slug7', '2026-11-03T20:00:00Z', '2026-11-03T20:00:00Z');`);
  sends = []; dms = []; dmTo = []; republishError = null; republished = []; logs = []; recap = 'https://r/recap-2026-11-04.html'; sendError = null;
  clock = at('2026-11-04T15:59:00Z');
  ({ tick, stop } = startAwardPostTick({
    store, db, now: () => clock,
    sendImage: async (to, file, caption) => {
      sends.push({ to, file, caption, mayPostInside: mayPost(GROUP) });
      if (sendError) throw sendError;
    },
    recapUrlFor: async () => recap,
    republish: async (id) => { republished.push(id); if (republishError) throw republishError; },
    sendText: async (to, text) => { dmTo.push(to); if (!dms.includes(text)) dms.push(text); },
    log: (l) => logs.push(l),
    autoStart: false,
  }));
});
afterEach(() => {
  stop();
  if (prevData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = prevData;
});

describe('award post tick', () => {
  it('nothing at 07:59, one send at 08:00 with the caption, inside the allow wrapper', async () => {
    seedRound();
    await tick();
    expect(sends).toHaveLength(0);
    expect(mayPost(GROUP)).toBe(false);
    clock = at(D1_0800);
    await tick();
    expect(sends).toHaveLength(1);
    expect(sends[0].to).toBe(GROUP);
    expect(sends[0].file).toBe('/p.jpg');
    expect(sends[0].mayPostInside).toBe(true);
    expect(sends[0].caption).toContain('🏆 BBB');
    expect(sends[0].caption).toContain('https://d/d2/slug7/?view=awards&src=award#award-bbb');
    expect(sends[0].caption).toContain("☀️ This morning's recap: https://r/recap-2026-11-04.html?src=award");
    expect(republished).toEqual([7]);
    expect(dms).toEqual(['Posted BBB.']);
    expect(dmTo).toEqual(['1@c.us', '3@c.us']);
    expect(store.get('bbb', 7).postedAt).toBe(D1_0800);
    expect(store.get('bbb', 7).sentAt).toBe(D1_0800);
    expect(mayPost(GROUP)).toBe(false);
    expect(logs.join('\n')).toContain('[awards] posted bbb round 7');
  });

  it('two ticks at 08:00 and 08:01 send once', async () => {
    seedRound();
    clock = at(D1_0800);
    await tick();
    clock = at('2026-11-04T16:01:00Z');
    await tick();
    expect(sends).toHaveLength(1);
  });

  it('postedAt is persisted before the send starts', async () => {
    seedRound();
    clock = at(D1_0800);
    let seen: string | undefined;
    stop();
    const t = startAwardPostTick({
      store, db: new Database(':memory:').exec(`CREATE TABLE digest2_shares(round_id INTEGER, slug TEXT, created_at TEXT);
        INSERT INTO digest2_shares VALUES (7,'s','2026-11-03T20:00:00Z');`) as never, now: () => clock,
      sendImage: async () => { seen = store.get('bbb', 7).postedAt; },
      recapUrlFor: async () => null, republish: async () => {}, sendText: async () => {}, log: () => {}, autoStart: false,
    });
    await t.tick();
    t.stop();
    expect(seen).toBe(D1_0800);
  });

  it('bot down: 10:30 still sends; 11:05 is skipped with an owner DM and no send', async () => {
    seedRound();
    clock = at('2026-11-04T18:30:00Z');
    await tick();
    expect(sends).toHaveLength(1);

    seedRound(); // reset to approved and unposted
    sends.length = 0; dms.length = 0;
    clock = at('2026-11-04T19:05:00Z');
    await tick();
    expect(sends).toHaveLength(0);
    expect(store.get('bbb', 7).skipped).toBeTruthy();
    expect(dms).toEqual(['Missed the posting window for BBB; nothing was posted.']);
    expect(logs.join('\n')).toContain('[awards] skipped bbb');
    await tick();
    expect(dms).toHaveLength(1);
  });

  it('not approved: no send', async () => {
    seedRound({ approvedAt: undefined, approvals: [] });
    clock = at(D1_0800);
    await tick();
    expect(sends).toHaveLength(0);
  });

  it('approved after day-1 08:00: waits for the next 08:00', async () => {
    seedRound({ approvedAt: '2026-11-04T20:00:00Z' });
    clock = at('2026-11-04T21:00:00Z');
    await tick();
    expect(sends).toHaveLength(0);
    clock = at('2026-11-05T16:00:00Z');
    await tick();
    expect(sends).toHaveLength(1);
  });

  it('recap missing: caption has no recap line', async () => {
    seedRound();
    recap = null;
    clock = at(D1_0800);
    await tick();
    expect(sends[0].caption).not.toContain('recap');
  });

  it('send failure: owner DM, postedAt stays, postFailed set, no retry', async () => {
    seedRound();
    sendError = Object.assign(new Error('boom'), { name: 'SendError' });
    clock = at(D1_0800);
    await tick();
    expect(dms).toEqual(["Couldn't post BBB: SendError: boom. Check the group first; it may have posted. Re-approve only if it didn't."]);
    expect(dmTo).toEqual(['1@c.us', '3@c.us']);
    const r = store.get('bbb', 7);
    expect(r.postedAt).toBe(D1_0800);
    expect(r.sentAt).toBeUndefined();
    expect(r.postFailed).toBe(true);
    expect(mayPost(GROUP)).toBe(false);
    expect(republished).toEqual([]);
    clock = at('2026-11-04T16:05:00Z');
    await tick();
    expect(sends).toHaveLength(1);
    expect(logs.join('\n')).not.toContain('boom');
  });

  it('unknown award in rounds is ignored', async () => {
    seedRound({ award: 'gone' });
    clock = at(D1_0800);
    await tick();
    expect(sends).toHaveLength(0);
  });

  it('sentAt is set only after the send resolves', async () => {
    seedRound();
    clock = at(D1_0800);
    let during: string | undefined = 'unset';
    stop();
    const t = startAwardPostTick({
      store, db, now: () => clock,
      sendImage: async () => { during = store.get('bbb', 7).sentAt; },
      recapUrlFor: async () => null, republish: async () => {}, sendText: async () => {}, log: () => {}, autoStart: false,
    });
    await t.tick();
    t.stop();
    expect(during).toBeUndefined();
    expect(store.get('bbb', 7).sentAt).toBe(D1_0800);
  });

  it('republish failure after a good post: owners and approvers told the link may lag, and logged', async () => {
    seedRound();
    republishError = new Error('republish 500');
    clock = at(D1_0800);
    await tick();
    expect(sends).toHaveLength(1);
    expect(dms).toEqual(["Posted BBB, but the digest didn't refresh, so the Awards link may not show it yet."]);
    expect(dmTo).toEqual(['1@c.us', '3@c.us']);
    expect(logs.join('\n')).toContain('[awards] republish failed bbb round 7');
    expect(store.get('bbb', 7).sentAt).toBe(D1_0800);
  });

  it('approvedAt without every approver in approvals: no send', async () => {
    seedRound({ approvals: ['1@c.us'] });
    clock = at(D1_0800);
    await tick();
    expect(sends).toHaveLength(0);
    seedRound({ approvals: [] });
    await tick();
    expect(sends).toHaveLength(0);
  });

  it('approvals stored as bare digits still count (ids normalised)', async () => {
    seedRound({ approvals: ['1', '3@c.us'] });
    clock = at(D1_0800);
    await tick();
    expect(sends).toHaveLength(1);
  });

  it('R14: approved later than the next day 08:00 -> skipped with a DM, nothing sent', async () => {
    seedRound({ approvedAt: '2026-11-05T17:00:00Z' });
    clock = at('2026-11-05T17:01:00Z');
    await tick();
    expect(sends).toHaveLength(0);
    expect(store.get('bbb', 7).skipped).toBeTruthy();
    expect(dms).toEqual(['Missed the posting window for BBB; nothing was posted.']);
    expect(dmTo).toEqual(['1@c.us', '3@c.us']);
  });

  it('no release for the round: skipped by the tick, untouched', async () => {
    seedRound({ roundId: 8 });
    clock = at(D1_0800);
    await tick();
    expect(sends).toHaveLength(0);
    expect(store.get('bbb', 8).skipped).toBeUndefined();
  });

  it('postAt comes from a fresh read, not the tick snapshot', async () => {
    db.exec(`INSERT INTO digest2_shares VALUES (8, 'slug8', '2026-11-03T20:00:00Z', '2026-11-03T20:00:00Z')`);
    seedRound();
    seedRound({ roundId: 8 });
    clock = at(D1_0800);
    stop();
    const t = startAwardPostTick({
      store, db, now: () => clock,
      // While round 7 sends, round 8 is re-approved after today's 08:00, so it waits for tomorrow.
      sendImage: async (to, file, caption) => {
        sends.push({ to, file, caption, mayPostInside: true });
        store.put({ ...store.get('bbb', 8), approvedAt: '2026-11-04T16:00:30Z' });
      },
      recapUrlFor: async () => null, republish: async () => {}, sendText: async () => {}, log: () => {}, autoStart: false,
    });
    await t.tick();
    t.stop();
    expect(sends).toHaveLength(1);
    expect(store.get('bbb', 8).postedAt).toBeUndefined();
  });
});

describe('makeRecapUrlFor', () => {
  it('HEAD without following redirects; exact 200 returns the built URL', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const mk = (status: number, url = 'https://elsewhere/x') =>
      makeRecapUrlFor((async (u: string, init?: RequestInit) => { calls.push({ url: u, init }); return { status, url } as Response; }) as never, () => 'https://r/');
    expect(await mk(200)('2026-11-04')).toBe('https://r/recap-2026-11-04.html');
    expect(calls[0].url).toBe('https://r/recap-2026-11-04.html');
    expect(calls[0].init?.method).toBe('HEAD');
    expect(calls[0].init?.redirect).toBe('manual');
    expect(await mk(302)('2026-11-04')).toBeNull();
    expect(await mk(0)('2026-11-04')).toBeNull();
    expect(await mk(204)('2026-11-04')).toBeNull();
    const boom = makeRecapUrlFor((async () => { throw new Error('net'); }) as never, () => 'https://r');
    expect(await boom('2026-11-04')).toBeNull();
  });
});
