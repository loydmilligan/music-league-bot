import { describe, it, expect } from 'vitest';
import { parseDiscordLog } from './discordChat.js';

const SAMPLE = [
  'south side secret club - "MusicLeague" thread (musics-chat) log',
  'Month: March 2026',
  'Total messages: 3',
  '',
  '[03/01/2026, 07:57 AM UTC] KarBen (MDR): I shall soon',
  '[03/01/2026, 05:31 PM UTC] Dogsweat 🚂: bullets stuff.Spoiler (edited)Sunday, March 1, 2026 at 9:32 AM',
  '[03/01/2026, 11:08 PM UTC] missmara: line one',
  'still missmara continued',
  '[03/01/2026, 11:08 PM UTC] missmara: line one',
  'still missmara continued',
].join('\n');

describe('parseDiscordLog', () => {
  it('parses records, strips edited trailer, joins continuations, drops consecutive dupes', () => {
    const msgs = parseDiscordLog(SAMPLE);
    expect(msgs.map((m) => m.sender)).toEqual(['KarBen (MDR)', 'Dogsweat 🚂', 'missmara']);
    expect(msgs[0].tsMs).toBe(Date.parse('2026-03-01T07:57:00Z'));
    expect(msgs[1].text).toBe('bullets stuff.');            // trailer stripped
    expect(msgs[2].text).toBe('line one\nstill missmara continued'); // continuation joined
    // the 4th line is a consecutive duplicate of msg[2] → collapsed, so only 3 total
    expect(msgs).toHaveLength(3);
  });
});
