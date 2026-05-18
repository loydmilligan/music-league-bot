import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getChatSongById } from '$lib/chat/chat.js';
import { addShortlistSong, deleteShortlistSongByUri } from '$lib/shortlist/shortlist.js';

export const POST: RequestHandler = async ({ params }) => {
  const db = getDb();
  const song = getChatSongById(db, params.id);
  if (!song) throw error(404, 'song not found');
  addShortlistSong(db, {
    spotifyUri: song.spotifyUri, title: song.title, artist: song.artist,
    album: song.album, albumArtUrl: song.albumArtUrl,
    year: song.year, durationSec: song.durationSec,
  });
  return json({ ok: true }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const db = getDb();
  const song = getChatSongById(db, params.id);
  if (!song) throw error(404, 'song not found');
  deleteShortlistSongByUri(db, song.spotifyUri);
  return json({ ok: true });
};
