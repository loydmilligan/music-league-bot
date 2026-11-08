import { describe, expect, it, vi } from 'vitest';
import { createJevPicker, JevPickHttpError, jevPickState } from '../src/chat/jevPick.js';

const state = { chat: 'c', speaker: 's', request: 'r', recent_messages: [] };
// Mirrors the API: criteria must be a record, an array is rejected with 400.
const okFetch = (body: unknown) =>
  vi.fn(async (_u: unknown, init?: RequestInit) => {
    const criteria = JSON.parse(String(init?.body ?? '{}')).questions?.pick?.criteria;
    if (Array.isArray(criteria)) return new Response('expected record, received array', { status: 400 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

describe('createJevPicker', () => {
  it('POSTs a choice question to the decisions endpoint', async () => {
    const fetchImpl = okFetch({ answers: { pick: { choice: 'a' } } });
    await createJevPicker({ apiKey: 'k', fetchImpl }).pick('ins', ['a', 'b'], state);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body)).toEqual({
      model: 'typesafe/jev-1.13',
      state,
      questions: { pick: { type: 'choice', instructions: 'ins', criteria: { a: 'a', b: 'b' } } },
    });
  });

  it('sends criteria as an object of option -> description', async () => {
    const fetchImpl = okFetch({ answers: { pick: { choice: '😂' } } });
    const p = createJevPicker({ apiKey: 'k', fetchImpl });
    await p.pick('i', ['😂', '🎉'], state);
    expect(JSON.parse((fetchImpl as any).mock.calls[0][1].body).questions.pick.criteria).toEqual({ '😂': '😂', '🎉': '🎉' });
    await p.pick('i', ['bigger-than', 'hype'], state, { 'bigger-than': 'size, …' });
    expect(JSON.parse((fetchImpl as any).mock.calls[1][1].body).questions.pick.criteria).toEqual({
      'bigger-than': 'size, …',
      hype: 'hype',
    });
  });

  it('throws JevPickHttpError with the status on 400', async () => {
    const fetchImpl = vi.fn(async () => new Response('secret body', { status: 400 })) as unknown as typeof fetch;
    const err = await createJevPicker({ apiKey: 'k', fetchImpl }).pick('i', ['a'], state).catch((e) => e);
    expect(err).toBeInstanceOf(JevPickHttpError);
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('secret');
  });

  it('an array criteria is rejected by the fake the way the API does', async () => {
    const r = await okFetch({})('u', { body: JSON.stringify({ questions: { pick: { criteria: ['a'] } } }) });
    expect(r.status).toBe(400);
  });

  it('returns the choice and cost', async () => {
    const fetchImpl = okFetch({ answers: { pick: { choice: '🍆' } }, usage: { cost: 0.0001 } });
    const r = await createJevPicker({ apiKey: 'k', fetchImpl }).pick('i', ['🍆', '🔥'], state);
    expect(r).toEqual({ choice: '🍆', cost: 0.0001 });
  });

  it('matches ignoring U+FE0F and returns the original option', async () => {
    const pick = (c: string) => createJevPicker({ apiKey: 'k', fetchImpl: okFetch({ answers: { pick: { choice: c } } }) }).pick('i', ['\u2620\uFE0F', '\u{1F602}'], state);
    expect((await pick('\u2620')).choice).toBe('\u2620\uFE0F');
    expect((await pick('\u{1F602}\uFE0F')).choice).toBe('\u{1F602}');
    expect((await pick('\u{1F525}')).choice).toBeNull();
  });

  it('returns null when choice is not an option or answers missing', async () => {
    const bad = okFetch({ answers: { pick: { choice: 'zzz' } } });
    expect((await createJevPicker({ apiKey: 'k', fetchImpl: bad }).pick('i', ['a'], state)).choice).toBeNull();
    const none = okFetch({});
    expect((await createJevPicker({ apiKey: 'k', fetchImpl: none }).pick('i', ['a'], state)).choice).toBeNull();
  });

  it('throws on HTTP 500', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    await expect(createJevPicker({ apiKey: 'k', fetchImpl }).pick('i', ['a'], state)).rejects.toThrow();
  });

  it('aborts after timeoutMs', async () => {
    const fetchImpl = vi.fn((_u: unknown, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason))),
    ) as unknown as typeof fetch;
    await expect(createJevPicker({ apiKey: 'k', fetchImpl, timeoutMs: 20 }).pick('i', ['a'], state)).rejects.toBeTruthy();
  });
});

describe('jevPickState', () => {
  it('strips the leading @token, caps lengths and keeps last 8 messages', () => {
    const prior = Array.from({ length: 10 }, (_, i) => ({ sender: `p${i}`, text: 'x'.repeat(600) }));
    const s = jevPickState({ chatName: 'chat', speaker: 'sp', body: '@123 ' + 'y'.repeat(900), priorMessages: prior });
    expect(s.request).toBe('y'.repeat(800));
    expect(s.chat).toBe('chat');
    expect(s.speaker).toBe('sp');
    expect(s.recent_messages).toHaveLength(8);
    expect(s.recent_messages[0].sender).toBe('p2');
    expect(s.recent_messages[0].text).toHaveLength(500);
  });
});
