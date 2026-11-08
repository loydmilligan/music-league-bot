import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { CMU_OWNER_TIMEOUT_MS } from '../../src/bot/catchMeUp.js';
import Database from 'better-sqlite3';
import { handleCmuDm, type CmuDmDeps } from '../../src/bot/cmuDm.js';
import { memoryCmuSwitch } from '../../src/bot/cmuSwitch.js';
import { memoryCmuPreview } from '../../src/bot/cmuPreview.js';
import { ensureSeenTables } from '../../src/storage/reactionsDb.js';
import { handleMessage, type WhatsAppMessage, type BotConfig } from '../../src/bot/handler.js';
import { openDb } from '../../src/storage/db.js';
import { createPromptTables, insertPrompt } from '../../src/chat/prompts/store.js';
import { rulesConfigSchema } from '../../src/config/types.js';

// Synthetic ids only.
const GROUP = '120363000000000001@g.us';
const PERSON_LID = '100000000000001@lid';
const PERSON_CUS = '15550000001@c.us';
const NOW = Date.parse('2026-11-07T18:00:00.000Z');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMock = Mock<(...args: any[]) => any>;

function setup(o: { people?: string[]; prompt?: boolean } = {}) {
  const league = new Database(':memory:');
  ensureSeenTables(league);
  league.prepare(`INSERT INTO wa_messages (msg_id, chat_id, author_id, snippet, ts) VALUES ('m1', ?, ?, '', ?)`)
    .run(GROUP, PERSON_LID, new Date(NOW - 60_000).toISOString());
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ kind: 'top', text: 'SYNTHETIC-TOP', images: [] }), { status: 200 })) as AnyMock;
  const sendText = vi.fn().mockResolvedValue(undefined) as AnyMock;
  const deps: CmuDmDeps = {
    fetchFn: fetchFn as unknown as typeof fetch,
    groups: new Map([[GROUP, 'league-x']]),
    url: 'http://host.invalid/catchup/me',
    token: 'sekret',
    screenshot: vi.fn(),
    sendImage: vi.fn(),
    sendText,
    log: vi.fn(),
    dmTarget: async (id) => (id === PERSON_CUS ? PERSON_LID : id),
    cmuSwitch: memoryCmuSwitch(),
    preview: memoryCmuPreview([], o.people ?? [PERSON_LID]),
    playerThrottle: new Map(),
    now: () => NOW,
    leagueDb: () => league,
  };
  const db = openDb(':memory:');
  createPromptTables(db);
  if (o.prompt) {
    insertPrompt(db, {
      id: 'p1', chatId: GROUP,
      options: [{ id: 'a', label: 'Koziol' }],
      templates: { matched: ['got {name}'], ambiguous: ['which?'], unmatched: ['no idea'] },
      acceptDirect: true,
    });
  }
  const cfg: BotConfig = {
    config: rulesConfigSchema.parse({ defaults: { requireCommandPrefix: true, commandPrefix: '!song' }, rules: [] }),
    spotify: { searchTrack: vi.fn(), getTrackById: vi.fn(), findOrCreatePlaylist: vi.fn(), isTrackInPlaylist: vi.fn(), addTrackToPlaylist: vi.fn() },
    db, allowedGroupIds: [], ownerPhone: '1@c.us', masterPlaylistName: 'M', sendDm: vi.fn(),
    cmuDm: (m) => handleCmuDm(m, deps),
  };
  return { cfg, fetchFn, sendText, deps };
}

function dm(body: string): WhatsAppMessage & { react: AnyMock; reply: AnyMock } {
  return {
    body, from: PERSON_CUS, chatName: '', author: PERSON_CUS, fromMe: false, capturedAt: new Date(NOW).toISOString(),
    priorMessages: [], notifyName: 'Alice',
    reply: vi.fn().mockResolvedValue(undefined),
    getContact: vi.fn().mockResolvedValue({ pushname: 'Alice' }),
    react: vi.fn().mockResolvedValue(undefined),
  } as WhatsAppMessage & { react: AnyMock; reply: AnyMock };
}

describe('handleMessage DM routing', () => {
  it('an exact DM command is handled before prompt answers', async () => {
    const s = setup({ prompt: true });
    const msg = dm('top-songs');
    await handleMessage(msg, s.cfg);
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
    expect(s.sendText).toHaveBeenCalledWith(PERSON_CUS, 'SYNTHETIC-TOP');
    expect(msg.reply).not.toHaveBeenCalled();
  });

  it('dm near-miss goes to prompt answers', async () => {
    for (const text of ['top songs please', 'pick one of these']) {
      const s = setup({ prompt: true });
      const msg = dm(text);
      await handleMessage(msg, s.cfg);
      expect(msg.reply).toHaveBeenCalledTimes(1);
      expect(s.fetchFn).not.toHaveBeenCalled();
      expect(msg.react).not.toHaveBeenCalled();
    }
  });

  it('non-preview person: dm goes to prompt answers, no companelist call, no reaction', async () => {
    const s = setup({ people: [], prompt: true });
    const msg = dm('top-songs');
    await handleMessage(msg, s.cfg);
    expect(msg.reply).toHaveBeenCalledTimes(1);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(msg.react).not.toHaveBeenCalled();
  });

  afterEach(() => { vi.useRealTimers(); });

  it('a stalled dmTarget never blocks prompt answers', async () => {
    const s = setup({ prompt: true });
    s.deps.dmTarget = () => new Promise<string>(() => {}); // never resolves
    vi.useFakeTimers();
    const msg = dm('Koziol');
    const done = handleMessage(msg, s.cfg);
    await vi.advanceTimersByTimeAsync(CMU_OWNER_TIMEOUT_MS);
    await done;
    expect(msg.reply).toHaveBeenCalledTimes(1);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(msg.react).not.toHaveBeenCalled();
  });

  it('a throwing router never blocks prompt answers', async () => {
    const s = setup({ prompt: true });
    s.cfg.cmuDm = async () => { throw new Error('boom'); };
    const msg = dm('Koziol');
    await handleMessage(msg, s.cfg);
    expect(msg.reply).toHaveBeenCalledTimes(1);
  });
});
