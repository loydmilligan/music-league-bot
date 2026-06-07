import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getSongStatusBatch, type SongStatusInput } from '$lib/db/songHistory.js';

// POST /api/history/song-status — batch history-status lookup for a Spotify
// search page (sprint-23, song-history-api). Body: { uris: [{uri, artist}] }.
// Returns { [uri]: { submittedByMe, submittedByOthers:[{league,season,round,by,points}],
// artistSubmittedByMe, chatMentions:[{by,quote}] } }. Powers D3 me-vs-others
// coloring (history-coloring) + the expanded-card corpus-history-panel.
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { uris?: SongStatusInput[] };
  if (!Array.isArray(body.uris)) {
    throw error(400, 'uris must be an array of { uri, artist }');
  }
  const items = body.uris
    .filter((i) => i && typeof i.uri === 'string' && i.uri)
    .map((i) => ({ uri: i.uri, artist: typeof i.artist === 'string' ? i.artist : '' }));
  return json(getSongStatusBatch(getDb(), items));
};
