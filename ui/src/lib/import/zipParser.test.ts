import { it, expect, describe } from 'vitest';
import AdmZip from 'adm-zip';
import { parseCsvRows, parseZip } from './zipParser.js';

describe('parseCsvRows — RFC-4180', () => {
  it('keeps embedded newlines inside quoted fields without fragmenting the row', () => {
    const text = 'A,B,C\n1,"line one\nline two",3\n';
    const rows = parseCsvRows(text);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['1', 'line one\nline two', '3']);
  });

  it('handles commas and escaped quotes inside quoted fields', () => {
    const text = 'A,B\n"x, y","she said ""hi"""\n';
    const rows = parseCsvRows(text);
    expect(rows[1]).toEqual(['x, y', 'she said "hi"']);
  });

  it('tolerates CRLF and a missing trailing newline', () => {
    const rows = parseCsvRows('A,B\r\n1,2');
    expect(rows).toEqual([['A', 'B'], ['1', '2']]);
  });
});

function zipOf(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

describe('parseZip — the Lori/round-102 failure mode', () => {
  it('a submission with a multi-line Comment keeps its Round ID (no orphaning)', () => {
    const submissions =
      'Spotify URI,Title,Album,Artist(s),Submitter ID,Created,Comment,Round ID,Visible To Voters\n' +
      'spotify:track:GYBR,Goodbye Yellow Brick Road,GYBR,Elton John,LORI,2026-05-11,' +
      '"This song.\n\nStarted my love for concerts.  ",ROUND1,Yes\n';
    const rounds = 'ID,Created,Name,Description,Playlist URL\nROUND1,2026-05-02,Your Permanent Record,' +
      '"A specific moment.\n\nTheme provided by Matt",https://x\n';
    const parsed = parseZip(zipOf({ 'submissions.csv': submissions, 'rounds.csv': rounds, 'votes.csv': 'Spotify URI,Voter ID,Created,Points Assigned,Comment,Round ID\n', 'competitors.csv': 'ID,Name\nLORI,lorimariani\n' }));

    expect(parsed.submissions).toHaveLength(1);
    expect(parsed.submissions[0].roundId).toBe('ROUND1'); // <- the bug: previously parsed empty
    expect(parsed.submissions[0].spotifyUri).toBe('spotify:track:GYBR');
    expect(parsed.submissions[0].comment).toContain('concerts');
  });

  it('a multi-line round Description does not spawn garbage rounds', () => {
    const rounds = 'ID,Created,Name,Description,Playlist URL\nROUND1,2026-05-02,Your Permanent Record,' +
      '"A specific moment.\n\nTheme provided by Matt",https://x\n';
    const parsed = parseZip(zipOf({ 'rounds.csv': rounds, 'submissions.csv': 'Spotify URI\n', 'votes.csv': 'Spotify URI\n', 'competitors.csv': 'ID,Name\n' }));
    expect(parsed.rounds).toHaveLength(1);
    expect(parsed.rounds[0].id).toBe('ROUND1');
    expect(parsed.rounds[0].description).toContain('Theme provided by Matt');
  });
});
