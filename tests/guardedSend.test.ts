import { describe, it, expect, vi } from 'vitest';
import { guardedSend, parseTargets } from '../src/whatsapp/sendGuard.js';

const STAGING = '120363406254406895@g.us';
const targets = { 'fam-jam': STAGING };
const TEXT = 'Round 123 digest → https://digest.mattmariani.com/d/abc123';

describe('guardedSend', () => {
  it('does not call the sender when the guard blocks', async () => {
    const send = vi.fn();
    const r = await guardedSend({ targets }, 'fam-jam', TEXT, send);

    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
  });

  it('does not call the sender in dry-run even with a live target configured', async () => {
    const send = vi.fn();
    const r = await guardedSend({ mode: 'dry-run', targets }, 'fam-jam', TEXT, send);

    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
  });

  it('does not call the sender for a league with no target', async () => {
    const send = vi.fn();
    const r = await guardedSend({ mode: 'live', targets }, 'second-best', TEXT, send);

    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
  });

  it('returns a preview of the exact text and target that would have been sent', async () => {
    const r = await guardedSend({ mode: 'dry-run', targets }, 'fam-jam', TEXT, vi.fn());

    expect(r.preview).toContain(TEXT);
    expect(r.preview).toContain(STAGING);
  });

  it('sends to the configured league target in live mode', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await guardedSend({ mode: 'live', targets }, 'fam-jam', TEXT, send);

    expect(send).toHaveBeenCalledWith(STAGING, TEXT);
    expect(r.sent).toBe(true);
  });

  it('refuses to send empty text', async () => {
    const send = vi.fn();
    const r = await guardedSend({ mode: 'live', targets }, 'fam-jam', '   ', send);

    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });
});

describe('parseTargets', () => {
  it('parses a league → group map', () => {
    expect(parseTargets(JSON.stringify(targets))).toEqual(targets);
  });

  it('yields no targets when unset', () => {
    expect(parseTargets(undefined)).toEqual({});
  });

  it('yields no targets on malformed JSON rather than throwing', () => {
    expect(parseTargets('{not json')).toEqual({});
  });

  it('yields no targets when the JSON is not an object', () => {
    expect(parseTargets('["a"]')).toEqual({});
  });

  it('drops non-string values', () => {
    expect(parseTargets('{"a": 5, "b": "x@g.us"}')).toEqual({ b: 'x@g.us' });
  });
});
