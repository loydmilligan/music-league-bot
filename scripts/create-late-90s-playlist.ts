import 'dotenv/config';
import { spotifyFetch } from '../src/spotify/token.js';

const PLAYLIST_NAME = 'Late 90s Essentials (1995–1999)';

const TRACKS: Array<{ artist: string; title: string; note?: string }> = [
  // Eminem
  { artist: 'Eminem', title: 'My Name Is' },
  { artist: 'Eminem', title: '97 Bonnie & Clyde' },
  { artist: 'Eminem', title: 'Just Don\'t Give a F***' },

  // Radiohead
  { artist: 'Radiohead', title: 'Paranoid Android' },
  { artist: 'Radiohead', title: 'Karma Police' },
  { artist: 'Radiohead', title: 'Fake Plastic Trees' },
  { artist: 'Radiohead', title: 'Street Spirit (Fade Out)' },

  // At the Drive-In
  { artist: 'At the Drive-In', title: 'Napoleon Solo' },
  { artist: 'At the Drive-In', title: 'Chanbara' },

  // Busta Rhymes
  { artist: 'Busta Rhymes', title: 'Woo-Hah!! Got You All in Check' },
  { artist: 'Busta Rhymes', title: 'Put Your Hands Where My Eyes Could See' },
  { artist: 'Busta Rhymes', title: 'Gimme Some More' },

  // ODB (requested as "Shimmy Shimmy Ya by Busta Rhymes" — actually ODB)
  { artist: 'Ol\' Dirty Bastard', title: 'Shimmy Shimmy Ya', note: 'Listed as Busta Rhymes but this is ODB' },

  // OutKast
  { artist: 'OutKast', title: 'Rosa Parks' },
  { artist: 'OutKast', title: 'Elevators (Me & You)' },
  { artist: 'OutKast', title: 'Da Art of Storytellin\' (Pt. 1)' },

  // MF DOOM
  { artist: 'MF DOOM', title: 'Doomsday' },
  { artist: 'MF DOOM', title: 'Rhymes Like Dimes' },

  // Massive Attack
  { artist: 'Massive Attack', title: 'Teardrop' },
  { artist: 'Massive Attack', title: 'Angel' },
  { artist: 'Massive Attack', title: 'Risingson' },

  // Electronic
  { artist: 'Aphex Twin', title: 'Windowlicker' },
  { artist: 'Daft Punk', title: 'Around the World' },
  { artist: 'Portishead', title: 'Glory Box' },
  { artist: 'Boards of Canada', title: 'Roygbiv' },

  // Indie Rock / Post-Hardcore
  { artist: 'Fugazi', title: 'Bed for the Scraping' },
  { artist: 'Sleater-Kinney', title: 'Dig Me Out' },
  { artist: 'Neutral Milk Hotel', title: 'In the Aeroplane Over the Sea' },
  { artist: 'Pavement', title: 'Stereo' },

  // R&B / Hip-Hop
  { artist: 'Erykah Badu', title: 'On & On' },
  { artist: 'A Tribe Called Quest', title: 'Find a Way' },
  { artist: 'Lauryn Hill', title: 'Ex-Factor' },
  { artist: 'Lauryn Hill', title: 'Doo Wop (That Thing)' },
];

type SpotifyTrack = {
  uri: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string; release_date: string };
};

async function searchTrack(artist: string, title: string): Promise<SpotifyTrack | null> {
  const q = encodeURIComponent(`track:${title} artist:${artist}`);
  const res = await spotifyFetch(`/search?q=${q}&type=track&limit=5`);
  const data = await res.json() as { tracks: { items: SpotifyTrack[] } };
  const items = data.tracks.items;
  if (items.length === 0) return null;

  // Prefer a result whose release year is in range
  const inRange = items.find((t) => {
    const year = parseInt(t.album.release_date.slice(0, 4), 10);
    return year >= 1995 && year <= 1999;
  });

  return inRange ?? items[0] ?? null;
}

async function getUserId(): Promise<string> {
  const res = await spotifyFetch('/me');
  return ((await res.json()) as { id: string }).id;
}

async function createPlaylist(userId: string, name: string): Promise<string> {
  const res = await spotifyFetch(`/users/${userId}/playlists`, {
    method: 'POST',
    body: JSON.stringify({ name, public: false, description: 'Late 90s essentials (1995–1999)' }),
  });
  return ((await res.json()) as { id: string; external_urls: { spotify: string } & { id: string } }).id;
}

async function addTracks(playlistId: string, uris: string[]): Promise<void> {
  for (let i = 0; i < uris.length; i += 100) {
    await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
    });
  }
}

async function main(): Promise<void> {
  console.log(`\nSearching for ${TRACKS.length} tracks...\n`);

  const found: SpotifyTrack[] = [];
  const missed: string[] = [];
  const outOfRange: Array<{ query: string; year: number; track: SpotifyTrack }> = [];

  for (const { artist, title, note } of TRACKS) {
    const track = await searchTrack(artist, title);
    const label = `${artist} — ${title}${note ? ` (note: ${note})` : ''}`;

    if (!track) {
      console.log(`  ✗ NOT FOUND: ${label}`);
      missed.push(label);
      continue;
    }

    const year = parseInt(track.album.release_date.slice(0, 4), 10);
    if (year < 1995 || year > 1999) {
      console.log(`  ⚠ OUT OF RANGE (${year}): ${label}`);
      outOfRange.push({ query: label, year, track });
      found.push(track); // include anyway — best match available
    } else {
      console.log(`  ✓ ${year}  ${track.artists[0].name} — ${track.name}`);
      found.push(track);
    }
  }

  if (found.length === 0) {
    console.error('\nNo tracks found. Check Spotify credentials.');
    process.exit(1);
  }

  const userId = await getUserId();
  const playlistId = await createPlaylist(userId, PLAYLIST_NAME);
  await addTracks(playlistId, found.map((t) => t.uri));

  // Get the playlist URL
  const res = await spotifyFetch(`/playlists/${playlistId}`);
  const playlist = await res.json() as { external_urls: { spotify: string } };

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`✅ Created "${PLAYLIST_NAME}"`);
  console.log(`   ${found.length} tracks added`);
  console.log(`   ${playlist.external_urls.spotify}`);

  if (outOfRange.length > 0) {
    console.log(`\n⚠ Added but outside 1995–1999 window:`);
    for (const { query, year } of outOfRange) {
      console.log(`   ${year}  ${query}`);
    }
  }
  if (missed.length > 0) {
    console.log(`\n✗ Not found on Spotify:`);
    for (const m of missed) console.log(`   ${m}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
