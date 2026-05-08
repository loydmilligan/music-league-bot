import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spotifyFetch } from '../src/spotify/token.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const playlistId = process.argv[2];
const outArg = process.argv[3];

if (!playlistId) {
  console.error('Usage: npm run playlist-to-csv <playlistId> [output.csv]');
  process.exit(1);
}

type Item = {
  track: {
    name: string;
    artists: Array<{ name: string }>;
    uri: string;
    external_urls: { spotify: string };
  } | null;
};

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const res = await spotifyFetch(
  `/playlists/${playlistId}/tracks?fields=items(track(name,artists,uri,external_urls))&limit=100`,
);
const data = (await res.json()) as { items: Item[] };

const lines = ['title,artist,spotifyUrl'];
for (const { track } of data.items) {
  if (!track) continue;
  lines.push([
    track.name,
    track.artists[0]?.name ?? '',
    track.external_urls.spotify,
  ].map(csvEscape).join(','));
}

const csv = lines.join('\n') + '\n';

if (outArg) {
  const outPath = path.resolve(outArg);
  writeFileSync(outPath, csv, 'utf8');
  console.log(`Wrote ${data.items.length} tracks to ${outPath}`);
} else {
  process.stdout.write(csv);
}
