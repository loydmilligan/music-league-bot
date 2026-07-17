import { describe, it, expect } from 'vitest';
import { resolveSendTarget } from '../src/whatsapp/sendGuard.js';

const STAGING = '120363406254406895@g.us';
const LEAGUE_GROUP = '120363426758906011@g.us';

const targets = { 'fam-jam': STAGING, 'hip-jammers': LEAGUE_GROUP };

describe('resolveSendTarget', () => {
  it('blocks by default when no mode is configured', () => {
    expect(resolveSendTarget({ targets }, 'fam-jam').action).toBe('block');
  });

  it('blocks in dry-run even with a target configured', () => {
    expect(resolveSendTarget({ mode: 'dry-run', targets }, 'fam-jam').action).toBe('block');
  });

  it('sends to the league-specific target in live mode', () => {
    expect(resolveSendTarget({ mode: 'live', targets }, 'fam-jam')).toMatchObject({
      action: 'send',
      target: STAGING,
    });
  });

  it('routes each league to its own target', () => {
    expect(resolveSendTarget({ mode: 'live', targets }, 'hip-jammers')).toMatchObject({
      action: 'send',
      target: LEAGUE_GROUP,
    });
  });

  it('blocks a league that has no configured target', () => {
    const d = resolveSendTarget({ mode: 'live', targets }, 'second-best');
    expect(d.action).toBe('block');
    expect(d.reason).toMatch(/second-best/);
  });

  it('blocks a league whose target is empty', () => {
    // chat_league_group_map carries "nostalgia-pit": "" — an empty target is not a target.
    const d = resolveSendTarget({ mode: 'live', targets: { 'nostalgia-pit': '' } }, 'nostalgia-pit');
    expect(d.action).toBe('block');
  });

  it('blocks when the target is not a @g.us group id', () => {
    // The allowlist carries a @lid entry; it must never resolve as a send target.
    const d = resolveSendTarget({ mode: 'live', targets: { x: '36610938802265@lid' } }, 'x');
    expect(d.action).toBe('block');
  });

  it('blocks when the target is an individual chat', () => {
    const d = resolveSendTarget({ mode: 'live', targets: { x: '16617476822@c.us' } }, 'x');
    expect(d.action).toBe('block');
  });

  it('blocks when no targets are configured at all', () => {
    expect(resolveSendTarget({ mode: 'live' }, 'fam-jam').action).toBe('block');
  });

  it('blocks on an unrecognised mode rather than guessing', () => {
    expect(resolveSendTarget({ mode: 'LIVE!', targets }, 'fam-jam').action).toBe('block');
  });

  it('explains why it blocked', () => {
    expect(resolveSendTarget({ targets }, 'fam-jam').reason).toMatch(/\S/);
  });
});
