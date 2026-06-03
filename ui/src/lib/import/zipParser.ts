import AdmZip from 'adm-zip';

export interface ParsedRound { id: string; createdAt: string; name: string; description: string; playlistUrl: string; }
export interface ParsedSubmission { spotifyUri: string; title: string; album: string; artists: string; submitterId: string; createdAt: string; comment: string; roundId: string; visibleToVoters: boolean; }
export interface ParsedVote { spotifyUri: string; voterId: string; createdAt: string; points: number; comment: string; roundId: string; }
export interface ParsedCompetitor { id: string; name: string; }
export interface ParsedZip { rounds: ParsedRound[]; submissions: ParsedSubmission[]; votes: ParsedVote[]; competitors: ParsedCompetitor[]; }

// RFC-4180-correct CSV parse. The old version did `text.split('\n')` and tracked
// quote-state per physical line, so any quoted field containing an embedded
// newline (a multi-line vote/submission Comment or round Description) fragmented
// the row — trailing columns shifted/emptied (e.g. a submission's Round ID lost,
// orphaning it from its round; or a Description split into garbage "rounds").
// This parser scans the whole text with a single quote-aware state machine,
// handling embedded newlines AND commas inside quotes, plus "" escaped quotes.
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  let started = false; // did the current row see any content/field?
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else inQ = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQ = true; started = true; continue; }
    if (ch === ',') { row.push(field); field = ''; started = true; continue; }
    if (ch === '\r') continue;                            // tolerate CRLF
    if (ch === '\n') {
      if (started || field.length) { row.push(field); rows.push(row); }
      row = []; field = ''; started = false;
      continue;
    }
    field += ch; started = true;
  }
  if (started || field.length) { row.push(field); rows.push(row); }
  return rows;
}

function csv(text: string): Record<string,string>[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(cols =>
    Object.fromEntries(headers.map((h, i) => [h, (cols[i] ?? '').trim()])),
  );
}

export function parseZip(buf: Buffer): ParsedZip {
  const zip = new AdmZip(buf);
  const rounds = csv(zip.readAsText('rounds.csv') ?? '').filter(r => r['ID']).map(r => ({
    id: r['ID'], createdAt: r['Created'], name: r['Name'], description: r['Description'] ?? '', playlistUrl: r['Playlist URL'] ?? '',
  }));
  const submissions = csv(zip.readAsText('submissions.csv') ?? '').filter(s => s['Spotify URI']).map(s => ({
    spotifyUri: s['Spotify URI'], title: s['Title'], album: s['Album'] ?? '', artists: s['Artist(s)'] ?? '',
    submitterId: s['Submitter ID'], createdAt: s['Created'], comment: s['Comment'] ?? '',
    roundId: s['Round ID'], visibleToVoters: s['Visible To Voters'] === 'Yes',
  }));
  const votes = csv(zip.readAsText('votes.csv') ?? '').filter(v => v['Spotify URI']).map(v => ({
    spotifyUri: v['Spotify URI'], voterId: v['Voter ID'], createdAt: v['Created'],
    points: parseInt(v['Points Assigned'] ?? '0', 10), comment: v['Comment'] ?? '', roundId: v['Round ID'],
  }));
  const competitors = csv(zip.readAsText('competitors.csv') ?? '').filter(c => c['ID']).map(c => ({ id: c['ID'], name: c['Name'] }));
  return { rounds, submissions, votes, competitors };
}
