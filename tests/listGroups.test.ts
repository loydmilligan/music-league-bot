import { describe, it, expect } from 'vitest';
import { formatEnvelope, type MsgEnvelope } from '../src/whatsapp/listGroups.js';

describe('formatEnvelope', () => {
  it('finds the group id in `to` when you sent the message', () => {
    // Your own message: from is your LID, to is the group.
    const e: MsgEnvelope = {
      from: '36610938802265@lid',
      to: '120363406254406895@g.us',
      author: '36610938802265@lid',
      fromMe: true,
    };
    expect(formatEnvelope(e)).toContain('group=120363406254406895@g.us');
  });

  it('finds the group id in `from` when someone else sent it', () => {
    const e: MsgEnvelope = {
      from: '120363406254406895@g.us',
      to: '36610938802265@lid',
      author: '99999@c.us',
      fromMe: false,
    };
    expect(formatEnvelope(e)).toContain('group=120363406254406895@g.us');
  });

  it('always shows the raw envelope so nothing is hidden', () => {
    const out = formatEnvelope({ from: 'a@lid', to: 'b@g.us', author: 'c', fromMe: true });
    expect(out).toContain('from=a@lid');
    expect(out).toContain('to=b@g.us');
    expect(out).toContain('fromMe=true');
  });

  it('says so when the envelope has no @g.us id', () => {
    const out = formatEnvelope({ from: 'a@lid', to: 'b@lid', author: 'c', fromMe: true });
    expect(out).toMatch(/no @g\.us/i);
  });

  it('tolerates a missing `to`', () => {
    const out = formatEnvelope({ from: '120363406254406895@g.us', to: '', author: 'c', fromMe: false });
    expect(out).toContain('group=120363406254406895@g.us');
  });
});
