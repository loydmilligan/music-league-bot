import AdmZip from 'adm-zip';

export interface ParsedRound { id: string; createdAt: string; name: string; description: string; playlistUrl: string; }
export interface ParsedSubmission { spotifyUri: string; title: string; album: string; artists: string; submitterId: string; createdAt: string; comment: string; roundId: string; visibleToVoters: boolean; }
export interface ParsedVote { spotifyUri: string; voterId: string; createdAt: string; points: number; comment: string; roundId: string; }
export interface ParsedCompetitor { id: string; name: string; }
export interface ParsedZip { rounds: ParsedRound[]; submissions: ParsedSubmission[]; votes: ParsedVote[]; competitors: ParsedCompetitor[]; }

function csv(text: string): Record<string,string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    const vals: string[] = []; let inQ = false; let cur = '';
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
      else cur += ch;
    }
    vals.push(cur);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim()]));
  });
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
