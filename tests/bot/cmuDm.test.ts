import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import Database from 'better-sqlite3';
import { handleCmuDm, resolveDmGroup, type CmuDmDeps } from '../../src/bot/cmuDm.js';
import { runCatchMeUp, type CmuMessage } from '../../src/bot/catchMeUp.js';
import { memoryCmuSwitch } from '../../src/bot/cmuSwitch.js';
import { memoryCmuPreview } from '../../src/bot/cmuPreview.js';
import { MENU_HEADING } from '../../src/bot/cmuMenu.js';
import { ensureSeenTables } from '../../src/storage/reactionsDb.js';
import type { InteractionTrace } from '../../src/storage/interactionLog.js';
import type { WhatsAppMessage } from '../../src/bot/handler.js';

// Synthetic ids only.
const GROUP_A = '120363000000000001@g.us';
const GROUP_B = '120363000000000002@g.us';
const GROUP_OTHER = '120363000000000003@g.us';
const PERSON_LID = '100000000000001@lid';
const PERSON_CUS = '15550000001@c.us';
const STRANGER_CUS = '15550000009@c.us';
const STRANGER_LID = '100000000000009@lid';
const OWNER_LID = '100000000000002@lid';
const NOW = Date.parse('2026-11-07T18:00:00.000Z');
const AT = '2026-11-07T18:00:00.000Z';
const DM_HEADING = 'DM me any of these (no @ needed):';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<(...args: any[]) => any>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ID_MAP: Record<string, string> = { [PERSON_CUS]: PERSON_LID, [STRANGER_CUS]: STRANGER_LID };

const allSends: AnyMock[] = [];

function leagueDb(rows: Array<{ chat: string; author: string; ago: number }> = [{ chat: GROUP_A, author: PERSON_LID, ago: 3_600_000 }]) {
  const db = new Database(':memory:');
  ensureSeenTables(db);
  rows.forEach((r, i) => {
    db.prepare(`INSERT INTO wa_messages (msg_id, chat_id, author_id, snippet, ts) VALUES (?, ?, ?, '', ?)`)
      .run(`m${i}`, r.chat, r.author, new Date(NOW - r.ago).toISOString());
  });
  return db;
}

function setup(o: { people?: string[]; groups?: string[]; db?: Database.Database; enabled?: boolean; owner?: string } = {}) {
  const events: Array<{ ev: string; name?: string; f?: Record<string, unknown> }> = [];
  const trace: InteractionTrace = {
    id: 'abcdef012345',
    start: (f) => { events.push({ ev: 'start', f: { ...f } }); },
    step: (name, f) => { events.push({ ev: 'step', name, f: { ...f } }); },
    end: (outcome) => { events.push({ ev: 'end', name: outcome }); },
    thumbPath: () => '',
  };
  const fetchFn = vi.fn(async (_u: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as Record<string, unknown>;
    if (b.mode === 'status') return json(200, { kind: 'status', used: 1, limit: 3 });
    if (b.mode === 'top') return json(200, { kind: 'top', text: 'SYNTHETIC-TOP', images: [] });
    if (b.mode === 'recap') return json(200, { kind: 'recap', text: 'SYNTHETIC-RECAP' });
    return json(200, { kind: 'quiet', text: 'SYNTHETIC-QUIET', followUp: { lines: [] } });
  }) as AnyMock;
  const sendText = vi.fn().mockResolvedValue(undefined) as AnyMock;
  const sendImage = vi.fn().mockResolvedValue(undefined) as AnyMock;
  allSends.push(sendText, sendImage);
  const cmuSwitch = memoryCmuSwitch();
  if (o.enabled === false) cmuSwitch.set(false, new Date(NOW));
  const owner = o.owner ?? OWNER_LID;
  const dmTarget = vi.fn(async (id: string) => ID_MAP[id] ?? id) as AnyMock;
  const deps: CmuDmDeps = {
    fetchFn: fetchFn as unknown as typeof fetch,
    groups: new Map([[GROUP_A, 'league-x'], [GROUP_B, 'league-x'], [GROUP_OTHER, 'league-y']]),
    url: 'http://host.invalid/catchup/me',
    token: 'sekret',
    screenshot: vi.fn(),
    sendImage,
    sendText,
    log: vi.fn(),
    dmTarget,
    trace: () => trace,
    isOwner: async (a) => (ID_MAP[a] ?? a) === owner,
    cmuSwitch,
    preview: memoryCmuPreview(o.groups ?? [], o.people ?? [PERSON_LID]),
    playerThrottle: new Map(),
    helpThrottle: new Map(),
    helpCooldown: { min: 5 },
    now: () => NOW,
    leagueDb: () => o.db ?? leagueDb(),
  };
  const ends = () => events.filter((e) => e.ev === 'end').map((e) => e.name);
  const starts = () => events.filter((e) => e.ev === 'start').map((e) => e.f!);
  const bodies = () => fetchFn.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>);
  return { deps, events, ends, starts, bodies, fetchFn, sendText, sendImage, dmTarget };
}

function dm(body: string, from = PERSON_CUS) {
  return {
    body, from, chatName: '', author: from, fromMe: false, capturedAt: AT, priorMessages: [], notifyName: 'Alice',
    reply: vi.fn().mockResolvedValue(undefined),
    getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
    react: vi.fn().mockResolvedValue(undefined),
  } as WhatsAppMessage & { react: AnyMock; reply: AnyMock };
}

function groupMsg(author = PERSON_LID): CmuMessage & { react: AnyMock } {
  return {
    from: GROUP_A, author, capturedAt: AT, notifyName: 'Alice',
    getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
    react: vi.fn().mockResolvedValue(undefined),
  } as CmuMessage & { react: AnyMock };
}

afterEach(() => {
  // Nothing is ever sent to a group id.
  for (const m of allSends) for (const c of m.mock.calls) expect(String(c[0]).endsWith('@g.us')).toBe(false);
  allSends.length = 0;
});

describe('resolveDmGroup', () => {
  const groups = new Map([[GROUP_A, 'league-x'], [GROUP_B, 'league-x'], [GROUP_OTHER, 'league-y']]);

  it('resolves dm group across lid and c.us', () => {
    const db = leagueDb([{ chat: GROUP_A, author: PERSON_LID, ago: 1000 }]);
    expect(resolveDmGroup([PERSON_CUS, PERSON_LID], groups, 'league-x', db, new Date(NOW))).toBe(GROUP_A);
    expect(resolveDmGroup([PERSON_CUS], groups, 'league-x', db, new Date(NOW))).toBeUndefined();
  });

  it('latest of two served groups wins', () => {
    const db = leagueDb([
      { chat: GROUP_A, author: PERSON_LID, ago: 5000 },
      { chat: GROUP_B, author: PERSON_LID, ago: 1000 },
    ]);
    expect(resolveDmGroup([PERSON_LID], groups, 'league-x', db, new Date(NOW))).toBe(GROUP_B);
  });

  it('group of other league ignored', () => {
    const db = leagueDb([
      { chat: GROUP_A, author: PERSON_LID, ago: 5000 },
      { chat: GROUP_OTHER, author: PERSON_LID, ago: 1000 },
    ]);
    expect(resolveDmGroup([PERSON_LID], groups, 'league-x', db, new Date(NOW))).toBe(GROUP_A);
    const onlyOther = leagueDb([{ chat: GROUP_OTHER, author: PERSON_LID, ago: 1000 }]);
    expect(resolveDmGroup([PERSON_LID], groups, 'league-x', onlyOther, new Date(NOW))).toBeUndefined();
  });

  it('ignores posts older than 30 days and unmapped chats', () => {
    const db = leagueDb([
      { chat: GROUP_A, author: PERSON_LID, ago: 31 * 86_400_000 },
      { chat: '120363000000000099@g.us', author: PERSON_LID, ago: 1000 },
    ]);
    expect(resolveDmGroup([PERSON_LID], groups, 'league-x', db, new Date(NOW))).toBeUndefined();
  });
});

describe('handleCmuDm', () => {
  it('dm top-songs from a group member gets a DM reply', async () => {
    const s = setup();
    const msg = dm('top-songs');
    expect(await handleCmuDm(msg, s.deps)).toBe(true);
    expect(s.bodies()[0]).toMatchObject({ league: 'league-x', via: 'dm', mode: 'top', requesterKey: PERSON_LID });
    expect(s.sendText).toHaveBeenCalledWith(PERSON_CUS, 'SYNTHETIC-TOP');
  });

  it('dm acknowledgement: the DM gets a 👍', async () => {
    const s = setup();
    const msg = dm('top-songs');
    await handleCmuDm(msg, s.deps);
    expect(msg.react).toHaveBeenCalledWith('👍');
  });

  it('stranger dm: no reply, falls through', async () => {
    const s = setup({ people: [PERSON_LID, STRANGER_LID] });
    const msg = dm('top-songs', STRANGER_CUS);
    expect(await handleCmuDm(msg, s.deps)).toBe(false);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(s.sendText).not.toHaveBeenCalled();
    expect(msg.react).not.toHaveBeenCalled();
    expect(s.ends()).toEqual(['unknown-dm']);
    expect(s.starts()[0]).toMatchObject({ via: 'dm' });
  });

  it('non-preview person: no parse, no companelist call, no reaction (G2)', async () => {
    const s = setup({ people: [] });
    const msg = dm('top-songs');
    expect(await handleCmuDm(msg, s.deps)).toBe(false);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(msg.react).not.toHaveBeenCalled();
    expect(s.events).toEqual([]);
  });

  it('a non-command DM is not handled', async () => {
    const s = setup();
    const msg = dm('top songs please');
    expect(await handleCmuDm(msg, s.deps)).toBe(false);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(s.events).toEqual([]);
  });

  it('dm owner command full is not handled (falls through)', async () => {
    const s = setup({ owner: PERSON_LID });
    for (const t of ['full', 'off', 'tldr', 'forget']) {
      expect(await handleCmuDm(dm(t), s.deps)).toBe(false);
    }
    expect(s.fetchFn).not.toHaveBeenCalled();
  });

  it('recap-bot-calls by non-owner falls through', async () => {
    const s = setup();
    const msg = dm('recap-bot-calls');
    expect(await handleCmuDm(msg, s.deps)).toBe(false);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(s.sendText).not.toHaveBeenCalled();
    expect(msg.react).not.toHaveBeenCalled();
  });

  it('recap-bot-calls by the owner runs sprint 1 runRecap with the DM author', async () => {
    const s = setup({ owner: PERSON_LID });
    const msg = dm('recap-bot-calls');
    expect(await handleCmuDm(msg, s.deps)).toBe(true);
    expect(s.bodies()[0]).toMatchObject({ mode: 'recap', requesterKey: PERSON_LID });
    expect(s.sendText).toHaveBeenCalledWith(PERSON_CUS, 'SYNTHETIC-RECAP');
    expect(s.ends()).toEqual(['recap']);
  });

  it('dm catch me up shares the limit: same requesterKey as the group path', async () => {
    const s = setup();
    await handleCmuDm(dm('catch me up'), s.deps);
    await runCatchMeUp(groupMsg(PERSON_LID), s.deps, { kind: 'catchup' });
    const [d, g] = s.bodies();
    expect(d.requesterKey).toBe(PERSON_LID);
    expect(g.requesterKey).toBe(d.requesterKey);
    expect(d.league).toBe(g.league);
  });

  it('body has via dm (and the group body none)', async () => {
    const s = setup();
    await handleCmuDm(dm('catch me up'), s.deps);
    await runCatchMeUp(groupMsg(PERSON_LID), s.deps, { kind: 'catchup' });
    const [d, g] = s.bodies();
    expect(d.via).toBe('dm');
    expect(g.via).toBeUndefined();
    expect(s.sendText).toHaveBeenCalledWith(PERSON_CUS, 'SYNTHETIC-QUIET');
  });

  it('off switch silences dm commands', async () => {
    const s = setup({ enabled: false });
    for (const t of ['top-songs', 'catch me up', 'help', 'morning-recap sub']) {
      const msg = dm(t);
      // Accepted behaviour: consumed silently (not a prompt answer), traced as disabled.
      expect(await handleCmuDm(msg, s.deps)).toBe(true);
      expect(msg.react).not.toHaveBeenCalled();
    }
    expect(s.ends()).toEqual(['disabled', 'disabled', 'disabled', 'disabled']);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(s.sendText).not.toHaveBeenCalled();
  });

  it('owner recap-bot-calls by DM still works while the switch is off', async () => {
    const s = setup({ enabled: false, owner: PERSON_LID });
    expect(await handleCmuDm(dm('recap-bot-calls'), s.deps)).toBe(true);
    expect(s.bodies().map((b) => b.mode)).toEqual(['recap']);
    expect(s.sendText).toHaveBeenCalledWith(PERSON_CUS, 'SYNTHETIC-RECAP');
  });

  it('owner DM of exactly "on" while off falls through', async () => {
    const s = setup({ enabled: false, owner: PERSON_LID });
    const msg = dm('on');
    expect(await handleCmuDm(msg, s.deps)).toBe(false);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(s.sendText).not.toHaveBeenCalled();
    expect(msg.react).not.toHaveBeenCalled();
  });

  it('a throwing dmTarget means not a preview person', async () => {
    const s = setup();
    s.deps.dmTarget = async () => { throw new Error('boom'); };
    const msg = dm('top-songs');
    expect(await handleCmuDm(msg, s.deps)).toBe(false);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(msg.react).not.toHaveBeenCalled();
  });

  it('preview person in a non-preview group still gets dm commands, with previewPerson (G3)', async () => {
    const s = setup({ groups: [] });
    await handleCmuDm(dm('catch me up'), s.deps);
    // previewPerson: true opens sprint 2's gate, so the body asks for the follow-up.
    expect(s.bodies()[0]).toMatchObject({ accepts: ['followUp'], via: 'dm' });
    expect(s.sendText.mock.calls.some((c) => String(c[1]).includes(DM_HEADING))).toBe(true);
  });

  it('help by DM uses the DM list', async () => {
    const s = setup();
    expect(await handleCmuDm(dm('help'), s.deps)).toBe(true);
    const text = String(s.sendText.mock.calls[0][1]);
    expect(s.sendText.mock.calls[0][0]).toBe(PERSON_CUS);
    expect(text).toContain(DM_HEADING);
    expect(text).toContain('top-songs');
  });

  it('DM help and DM recap-bot-calls bodies carry via dm; a group help body does not', async () => {
    const s = setup({ owner: PERSON_LID });
    // Throttle the second help so it posts a status body (help itself makes no companelist call).
    s.deps.helpThrottle!.set(PERSON_CUS, NOW);
    await handleCmuDm(dm('help'), s.deps);
    await handleCmuDm(dm('recap-bot-calls'), s.deps);
    s.deps.helpThrottle!.set(PERSON_LID, NOW);
    await runCatchMeUp(groupMsg(PERSON_LID), s.deps, { kind: 'help' });
    const b = s.bodies();
    const help = b.find((x) => x.mode === 'status' && x.via === 'dm');
    const recap = b.find((x) => x.mode === 'recap');
    expect(help).toBeDefined();
    expect(recap?.via).toBe('dm');
    const groupHelp = b.filter((x) => x.mode === 'status' && x.via === undefined);
    expect(groupHelp.length).toBeGreaterThanOrEqual(1);
  });

  it('an empty preview people list skips the dmTarget lookup and falls through', async () => {
    const s = setup({ people: [] });
    const msg = dm('some prompt answer');
    expect(await handleCmuDm(msg, s.deps)).toBe(false);
    expect(await handleCmuDm(dm('top-songs'), s.deps)).toBe(false);
    expect(s.dmTarget).not.toHaveBeenCalled();
    expect(s.fetchFn).not.toHaveBeenCalled();
  });

  it('trace start carries via', async () => {
    const s = setup();
    await handleCmuDm(dm('top-songs'), s.deps);
    await runCatchMeUp(groupMsg(PERSON_LID), s.deps, { kind: 'catchup' });
    expect(s.starts().map((f) => f.via)).toEqual(['dm', 'group']);
    expect(s.starts()[0]).toMatchObject({ group: GROUP_A, instance: 'league-x' });
  });
});

describe('menu heading per recipient', () => {
  it('follow-up: DM heading and full menu for a preview person, group wording otherwise', async () => {
    const s = setup({ groups: [GROUP_A], people: [PERSON_LID] });
    await runCatchMeUp(groupMsg(PERSON_LID), s.deps, { kind: 'catchup' });
    const pv = String(s.sendText.mock.calls.at(-1)![1]);
    expect(pv).toContain(DM_HEADING);
    expect(pv).toContain('top-songs');

    const t = setup({ groups: [GROUP_A], people: [] });
    await runCatchMeUp(groupMsg(PERSON_LID), t.deps, { kind: 'catchup' });
    const plain = String(t.sendText.mock.calls.at(-1)![1]);
    expect(plain).toContain(MENU_HEADING);
    expect(plain).not.toContain(DM_HEADING);
    expect(plain).not.toContain('top-songs');
  });

  it('follow-up key is normalised through dmTarget (c.us author, lid allowlist)', async () => {
    const s = setup({ groups: [GROUP_A], people: [PERSON_LID] });
    await runCatchMeUp(groupMsg(PERSON_CUS), s.deps, { kind: 'catchup' });
    expect(String(s.sendText.mock.calls.at(-1)![1])).toContain(DM_HEADING);
  });

  it('group @bot help: dmOk per isPreviewPerson(dmTarget(author))', async () => {
    const s = setup({ people: [PERSON_LID] });
    await runCatchMeUp(groupMsg(PERSON_CUS), s.deps, { kind: 'help' });
    expect(String(s.sendText.mock.calls[0][1])).toContain(DM_HEADING);

    const t = setup({ people: [] });
    await runCatchMeUp(groupMsg(PERSON_CUS), t.deps, { kind: 'help' });
    const text = String(t.sendText.mock.calls[0][1]);
    expect(text).not.toContain(DM_HEADING);
    expect(text).toContain('Catch-up bot — what you can ask');
  });
});
