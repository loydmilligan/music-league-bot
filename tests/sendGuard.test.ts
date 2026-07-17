import { describe, it, expect } from 'vitest';
import { resolveSendTarget } from '../src/whatsapp/sendGuard.js';

const OWNER = '16617476822@c.us';
const GROUP = '120363426758906011@g.us';

describe('resolveSendTarget', () => {
  it('blocks by default when no mode is configured', () => {
    const d = resolveSendTarget({ ownerPhone: OWNER });
    expect(d.action).toBe('block');
  });

  it('blocks when mode is dry-run', () => {
    const d = resolveSendTarget({ mode: 'dry-run', targetGroupId: GROUP, ownerPhone: OWNER });
    expect(d.action).toBe('block');
  });

  it('redirects to the owner in owner mode', () => {
    const d = resolveSendTarget({ mode: 'owner', ownerPhone: OWNER });
    expect(d).toMatchObject({ action: 'send', target: OWNER });
  });

  it('never targets the group in owner mode even when a group is configured', () => {
    const d = resolveSendTarget({ mode: 'owner', targetGroupId: GROUP, ownerPhone: OWNER });
    expect(d).toMatchObject({ action: 'send', target: OWNER });
  });

  it('sends to the configured group in live mode', () => {
    const d = resolveSendTarget({ mode: 'live', targetGroupId: GROUP, ownerPhone: OWNER });
    expect(d).toMatchObject({ action: 'send', target: GROUP });
  });

  it('blocks live mode when no target group is configured', () => {
    const d = resolveSendTarget({ mode: 'live', ownerPhone: OWNER });
    expect(d.action).toBe('block');
  });

  it('blocks live mode when the target is not a @g.us group id', () => {
    // WHATSAPP_ALLOWED_GROUP_IDS carries a @lid entry; it must never resolve as a send target.
    const d = resolveSendTarget({ mode: 'live', targetGroupId: '36610938802265@lid', ownerPhone: OWNER });
    expect(d.action).toBe('block');
  });

  it('blocks live mode when the target is an individual chat', () => {
    const d = resolveSendTarget({ mode: 'live', targetGroupId: OWNER, ownerPhone: OWNER });
    expect(d.action).toBe('block');
  });

  it('blocks on an unrecognised mode rather than guessing', () => {
    const d = resolveSendTarget({ mode: 'LIVE!', targetGroupId: GROUP, ownerPhone: OWNER });
    expect(d.action).toBe('block');
  });

  it('blocks when owner mode has no owner phone', () => {
    const d = resolveSendTarget({ mode: 'owner', ownerPhone: '' });
    expect(d.action).toBe('block');
  });

  it('explains why it blocked', () => {
    const d = resolveSendTarget({ ownerPhone: OWNER });
    expect(d.reason).toMatch(/\S/);
  });
});
