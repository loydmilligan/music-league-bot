import 'dotenv/config';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};
const hasFlag = (name: string) => args.includes(name);

const dbPath = path.join(__dirname, '../data/submissions.db');
const db = new Database(dbPath, { readonly: true });

if (hasFlag('--list-playlists')) {
  const rows = db.prepare(`
    SELECT DISTINCT playlist_name, COUNT(*) as count
    FROM submissions
    WHERE status = 'added' AND playlist_name IS NOT NULL
    GROUP BY playlist_name
    ORDER BY MIN(created_at) DESC
  `).all() as { playlist_name: string; count: number }[];

  console.log('\nAvailable playlists:\n');
  for (const row of rows) {
    console.log(`  ${row.count.toString().padStart(3)} songs  ${row.playlist_name}`);
  }
  console.log();
  db.close();
  process.exit(0);
}

const playlistFilter = flag('--playlist');
const sinceFlag = flag('--since');
const outFile = flag('--out');

let sinceMs: number | null = null;
if (sinceFlag) {
  const days = parseInt(sinceFlag, 10);
  if (isNaN(days)) {
    console.error(`--since expects a number of days, got: ${sinceFlag}`);
    process.exit(1);
  }
  sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
}

type Row = {
  track_title: string;
  track_artist: string | null;
  spotify_uri: string | null;
  source_url: string | null;
  submitter_name: string;
  playlist_name: string | null;
};

let query = `
  SELECT track_title, track_artist, spotify_uri, source_url, submitter_name, playlist_name
  FROM submissions
  WHERE status = 'added'
    AND track_title IS NOT NULL
`;
const params: Record<string, string | number> = {};

if (playlistFilter) {
  query += ` AND LOWER(playlist_name) LIKE LOWER(@playlist)`;
  params.playlist = `%${playlistFilter}%`;
}
if (sinceMs !== null) {
  query += ` AND created_at >= @since`;
  params.since = sinceMs;
}
query += ` ORDER BY created_at ASC`;

const rows = db.prepare(query).all(params) as Row[];
db.close();

function spotifyUriToUrl(uri: string): string {
  const trackId = uri.replace('spotify:track:', '');
  return `https://open.spotify.com/track/${trackId}`;
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Deduplicate by spotify_uri, keeping first occurrence
const seen = new Set<string>();
const unique = rows.filter((row) => {
  const key = row.spotify_uri ?? `${row.track_title}::${row.track_artist}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const header = 'title,artist,spotifyUrl,url,submitter';
const lines = unique.map((row) => {
  const spotifyUrl = row.spotify_uri ? spotifyUriToUrl(row.spotify_uri) : '';
  return [
    row.track_title,
    row.track_artist ?? '',
    spotifyUrl,
    row.source_url ?? spotifyUrl,
    row.submitter_name,
  ].map(csvEscape).join(',');
});

const csv = [header, ...lines].join('\n') + '\n';

if (outFile) {
  const outPath = path.resolve(outFile);
  writeFileSync(outPath, csv, 'utf8');
  console.log(`Exported ${unique.length} songs to ${outPath}`);
} else {
  process.stdout.write(csv);
  console.error(`\n${unique.length} songs exported`);
}
