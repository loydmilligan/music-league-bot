import { describe, it, expect, vi } from 'vitest';
import { serializeWid, mentionsSelf, seedSelfIds, isOwnReaction } from '../src/whatsapp/client.js';

const WID = '12134198455@c.us';
const LID = '186428122255581@lid';

describe('serializeWid', () => {
  it('handles strings, _serialized, $1 and user+server', () => {
    expect(serializeWid(WID)).toBe(WID);
    expect(serializeWid({ _serialized: WID })).toBe(WID);
    expect(serializeWid({ _serialized: undefined, $1: LID })).toBe(LID);
    expect(serializeWid({ user: '186428122255581', server: 'lid' })).toBe(LID);
  });

  it('is null for empty or unknown shapes', () => {
    expect(serializeWid('')).toBeNull();
    expect(serializeWid(undefined)).toBeNull();
    expect(serializeWid({ user: 'x' })).toBeNull();
    expect(serializeWid(42)).toBeNull();
  });
});

describe('mentionsSelf', () => {
  it('matches a mentioned id in any serialized shape', () => {
    const ids = new Set([LID]);
    expect(mentionsSelf([{ $1: LID }], 'hi', ids)).toBe(true);
    expect(mentionsSelf([{ user: '186428122255581', server: 'lid' }], 'hi', ids)).toBe(true);
    expect(mentionsSelf([LID], 'hi', ids)).toBe(true);
  });

  it('falls back to "@<digits>" in the body', () => {
    const ids = new Set([WID, LID]);
    expect(mentionsSelf([], '@186428122255581 catch me up', ids)).toBe(true);
    expect(mentionsSelf(undefined, 'yo @12134198455 cmu', ids)).toBe(true);
    expect(mentionsSelf([], '@1864281222555819 catch me up', ids)).toBe(false);
  });

  it('is false for someone else', () => {
    const ids = new Set([LID]);
    expect(mentionsSelf([{ $1: '999@lid' }], '@999 catch me up', ids)).toBe(false);
  });

  it('is false while selfIds is empty, true once seeded at ready', async () => {
    const ids = new Set<string>();
    const mention = [{ $1: LID }];
    const body = '@186428122255581 catch me up';
    expect(mentionsSelf(mention, body, ids)).toBe(false);

    const log = vi.fn();
    const client = {
      info: { wid: { _serialized: undefined, $1: undefined, user: '12134198455', server: 'c.us' } },
      getContactLidAndPhone: vi.fn().mockResolvedValue([{ lid: LID, pn: WID }]),
    };
    await seedSelfIds(client as never, ids, log);

    expect(client.getContactLidAndPhone).toHaveBeenCalledWith([WID]);
    expect([...ids].sort()).toEqual([WID, LID].sort());
    expect(log).toHaveBeenCalledWith(`[self] learned own id ${LID}`);
    expect(mentionsSelf(mention, body, ids)).toBe(true);
  });
});

describe('seedSelfIds', () => {
  it('keeps the wid when the LID lookup fails', async () => {
    const ids = new Set<string>();
    const log = vi.fn();
    await seedSelfIds(
      { info: { wid: WID }, getContactLidAndPhone: vi.fn().mockRejectedValue(new Error('r: r')) } as never,
      ids,
      log,
    );
    expect([...ids]).toEqual([WID]);
    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('lid lookup failed');
  });

  it('does nothing without a wid', async () => {
    const ids = new Set<string>();
    const lookup = vi.fn();
    await seedSelfIds({ info: {}, getContactLidAndPhone: lookup } as never, ids, vi.fn());
    expect(ids.size).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('isOwnReaction', () => {
  it('is true when the reaction id is fromMe, even with no known self ids', () => {
    expect(isOwnReaction({ id: { fromMe: true }, senderId: 'a@lid' }, new Set())).toBe(true);
  });

  it('is true when fromMe is false but the sender is a learned self id', () => {
    expect(isOwnReaction({ id: { fromMe: false }, senderId: LID }, new Set([LID]))).toBe(true);
  });

  it('is false for someone else', () => {
    expect(isOwnReaction({ id: { fromMe: false }, senderId: 'other@lid' }, new Set([LID]))).toBe(false);
  });

  it('is false when id and senderId are missing', () => {
    expect(isOwnReaction({}, new Set([LID]))).toBe(false);
  });
});
