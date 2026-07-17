import { describe, it, expect } from 'vitest';
import { formatGroupSighting, type ChatLike } from '../src/whatsapp/listGroups.js';

const group: ChatLike = {
  id: { _serialized: '120363406254406895@g.us' },
  name: 'Mlbot test group',
  isGroup: true,
};

describe('formatGroupSighting', () => {
  it('reports the real chat id and name, regardless of who sent the message', () => {
    const out = formatGroupSighting(group);

    expect(out).toContain('120363406254406895@g.us');
    expect(out).toContain('Mlbot test group');
  });

  it('marks a group as a group so a send target is easy to spot', () => {
    expect(formatGroupSighting(group)).toMatch(/group/i);
  });

  it('marks a non-group so it is not mistaken for a target', () => {
    const dm: ChatLike = { id: { _serialized: '16617476822@c.us' }, name: 'Matt', isGroup: false };
    expect(formatGroupSighting(dm)).toMatch(/not a group|dm/i);
  });

  it('tolerates a missing name', () => {
    const out = formatGroupSighting({ id: { _serialized: '1@g.us' }, name: '', isGroup: true });
    expect(out).toContain('1@g.us');
  });
});
