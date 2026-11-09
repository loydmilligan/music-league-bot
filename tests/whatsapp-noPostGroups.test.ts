import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GroupPostBlocked, assertMayPost, isListedNoPost, mayPost, withAllowedGroupPost } from '../src/whatsapp/noPostGroups.js';
import { resolveSendTarget } from '../src/whatsapp/sendGuard.js';

const BLOCKED = 'blocked@g.us';
const OTHER = 'other@g.us';
const DM = '123@lid';

describe('no-post groups', () => {
  let dir: string;
  const before = process.env.DATA_DIR;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nopost-'));
    process.env.DATA_DIR = dir;
    writeFileSync(path.join(dir, 'no-post-groups.json'), JSON.stringify({ groups: [BLOCKED] }));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (before === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = before;
  });

  it('blocks a listed group and allows other groups and DMs', () => {
    expect(mayPost(BLOCKED)).toBe(false);
    expect(mayPost(OTHER)).toBe(true);
    expect(mayPost(DM)).toBe(true);
    expect(() => assertMayPost(BLOCKED)).toThrow(GroupPostBlocked);
  });

  it('allows a listed group only inside the sample scope, including across awaits', async () => {
    const seen = await withAllowedGroupPost(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return mayPost(BLOCKED);
    });
    expect(seen).toBe(true);
    expect(mayPost(BLOCKED)).toBe(false);
  });

  it('with a missing or corrupt list blocks every group but never DMs', () => {
    rmSync(path.join(dir, 'no-post-groups.json'));
    expect(mayPost(OTHER)).toBe(false);
    expect(mayPost(DM)).toBe(true);
    writeFileSync(path.join(dir, 'no-post-groups.json'), '{nope');
    expect(mayPost(OTHER)).toBe(false);
    expect(mayPost(DM)).toBe(true);
  });

  it('isListedNoPost is true only for a listed id', () => {
    expect(isListedNoPost(BLOCKED)).toBe(true);
    expect(isListedNoPost(OTHER)).toBe(false);
  });

  it('a proactive send to a listed group is held before anything is claimed', () => {
    const d = resolveSendTarget({ mode: 'live', targets: { x: BLOCKED, y: OTHER } }, 'x');
    expect(d.action).toBe('block');
    expect(resolveSendTarget({ mode: 'live', targets: { x: BLOCKED, y: OTHER } }, 'y').action).toBe('send');
  });
});
