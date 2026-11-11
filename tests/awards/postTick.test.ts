import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startAwardPostTick } from '../../src/awards/postTick.js';
import { openAwardStore, type AwardStore } from '../../src/awards/store.js';
import type { AwardsConfig } from '../../src/awards/types.js';
import { mayPost } from '../../src/whatsapp/noPostGroups.js';

const GROUP = 'test@g.us';
const config: AwardsConfig = {
  postGroup: GROUP, groupName: 'G', leagueId: 1, digestBaseUrl: 'https://d/', recapBaseUrl: 'https://r',
  awards: [
    { key: 'bbb', prefix: 'bbb', name: 'BBB', owners: ['1'], approvers: ['1'], day: 1, window: 'round', promptTemplate: 'bbb.md' },
  ],
};
// Released Tue 2026-11-03 12:00 PST (20:00Z): day 1 = Wed 2026-11-04 08:00 PST = 16:00Z.
const D1_0800 = '2026-11-04T16:00:00.000Z';
const at = (iso: string) => new Date(iso);

let store: AwardStore;
let clock: Date;
let sends: { to: string; file: string; caption: string; mayPostInside: boolean }[];
let dms: string[];
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
    picks: { 1: 1, 2: 2, 3: 3 }, poster: '/p.jpg', approvals: ['1'], approvedAt: '2026-11-03T22:00:00Z', ...extra,
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
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE digest2_shares(round_id INTEGER PRIMARY KEY, slug TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO digest2_shares VALUES (7, 'slug7', '2026-11-03T20:00:00Z', '2026-11-03T20:00:00Z');`);
  sends = []; dms = []; republished = []; logs = []; recap = 'https://r/recap-2026-11-04.html'; sendError = null;
  clock = at('2026-11-04T15:59:00Z');
  ({ tick, stop } = startAwardPostTick({
    store, db, now: () => clock,
    sendImage: async (to, file, caption) => {
      sends.push({ to, file, caption, mayPostInside: mayPost(GROUP) });
      if (sendError) throw sendError;
    },
    recapUrlFor: async () => recap,
    republish: async (id) => { republished.push(id); },
    dmOwner: async (_a, text) => { dms.push(text); },
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
    expect(sends[0].caption).toContain("☀️ This morning's recap: https://r/recap-2026-11-04.html");
    expect(republished).toEqual([7]);
    expect(dms).toEqual(['Posted BBB.']);
    expect(store.get('bbb', 7).postedAt).toBe(D1_0800);
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
      recapUrlFor: async () => null, republish: async () => {}, dmOwner: async () => {}, log: () => {}, autoStart: false,
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
    expect(dms).toEqual(["Couldn't post BBB: SendError: boom. It won't retry; re-approve to try again."]);
    const r = store.get('bbb', 7);
    expect(r.postedAt).toBe(D1_0800);
    expect(r.postFailed).toBe(true);
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
});
