import { describe, it, expect, vi } from 'vitest';
import { guardedSend } from '../src/whatsapp/sendGuard.js';

const OWNER = '16617476822@c.us';
const GROUP = '120363426758906011@g.us';
const TEXT = 'Round 117 digest → https://digest.mattmariani.com/d/abc123';

describe('guardedSend', () => {
  it('does not call the sender when the guard blocks', async () => {
    const send = vi.fn();
    const r = await guardedSend({ ownerPhone: OWNER }, TEXT, send);

    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
  });

  it('does not call the sender in dry-run even with a live group configured', async () => {
    const send = vi.fn();
    const r = await guardedSend(
      { mode: 'dry-run', targetGroupId: GROUP, ownerPhone: OWNER },
      TEXT,
      send,
    );

    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
  });

  it('returns a preview of the exact text and target that would have been sent', async () => {
    const r = await guardedSend(
      { mode: 'dry-run', targetGroupId: GROUP, ownerPhone: OWNER },
      TEXT,
      vi.fn(),
    );

    expect(r.preview).toContain(TEXT);
    expect(r.preview).toContain(GROUP);
  });

  it('sends to the owner in owner mode', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await guardedSend({ mode: 'owner', ownerPhone: OWNER }, TEXT, send);

    expect(send).toHaveBeenCalledWith(OWNER, TEXT);
    expect(r.sent).toBe(true);
  });

  it('sends to the group in live mode', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = await guardedSend({ mode: 'live', targetGroupId: GROUP, ownerPhone: OWNER }, TEXT, send);

    expect(send).toHaveBeenCalledWith(GROUP, TEXT);
    expect(r.sent).toBe(true);
  });

  it('refuses to send empty text', async () => {
    const send = vi.fn();
    const r = await guardedSend({ mode: 'live', targetGroupId: GROUP, ownerPhone: OWNER }, '   ', send);

    expect(send).not.toHaveBeenCalled();
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/empty/i);
  });
});
