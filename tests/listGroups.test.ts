import { describe, it, expect } from 'vitest';
import { formatGroupList, type ChatLike } from '../src/whatsapp/listGroups.js';

const chat = (id: string, name: string, isGroup = true): ChatLike => ({
  id: { _serialized: id },
  name,
  isGroup,
});

describe('formatGroupList', () => {
  it('lists a group id alongside its name', () => {
    const out = formatGroupList([chat('120363406254406895@g.us', 'Mlbot test group')]);

    expect(out).toContain('120363406254406895@g.us');
    expect(out).toContain('Mlbot test group');
  });

  it('omits individual chats — only groups can be digest targets', () => {
    const out = formatGroupList([
      chat('16617476822@c.us', 'Matt', false),
      chat('120363406254406895@g.us', 'Mlbot test group'),
    ]);

    expect(out).not.toContain('16617476822');
    expect(out).toContain('120363406254406895@g.us');
  });

  it('sorts by name so the list is stable between runs', () => {
    const out = formatGroupList([chat('2@g.us', 'Zebra'), chat('1@g.us', 'Alpha')]);

    expect(out.indexOf('Alpha')).toBeLessThan(out.indexOf('Zebra'));
  });

  it('says so when there are no groups rather than printing nothing', () => {
    expect(formatGroupList([])).toMatch(/no groups/i);
  });

  it('tolerates a missing name', () => {
    const out = formatGroupList([{ id: { _serialized: '1@g.us' }, name: '', isGroup: true }]);
    expect(out).toContain('1@g.us');
  });
});
