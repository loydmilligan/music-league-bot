import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { ingestPlaylist } from '$lib/import/playlistIngest.js';
import { enqueueMany } from '$lib/db/metadataQueue.js';

export const POST: RequestHandler = async ({ params }) => {
  const roundId = Number(params.roundId);
  if (!Number.isInteger(roundId)) throw error(400, 'roundId must be an integer');

  const db = getDb();
  const round = db
    .prepare(
      `SELECT phase, spotify_playlist_url FROM rounds WHERE id = ?`,
    )
    .get(roundId) as { phase: string | null; spotify_playlist_url: string | null } | undefined;
  if (!round) throw error(404, 'round not found');

  // Data-safety guard: ml_submissions is a SHARED table feeding digests and
  // standings. Loading a completed (or any non-voting) round could write
  // rows that don't belong there, with no undo. Only the live voting phase
  // may be loaded.
  if (round.phase !== 'voting') {
    throw error(409, `round is not in the voting phase (phase: ${round.phase ?? 'unknown'})`);
  }

  const playlistUrl = round.spotify_playlist_url?.trim();
  if (!playlistUrl) {
    // Expected, normal state — not every round has picked up its "New
    // Playlist" email (or had one pasted in manually) yet.
    throw error(
      409,
      'no Spotify playlist URL set on this round yet — paste the playlist URL on the round first',
    );
  }

  const result = await ingestPlaylist(roundId, playlistUrl, { db });

  // Enqueue metadata enrichment so a freshly-loaded round doesn't sit with
  // every metadata chip (and every LLM take input) empty. ingestPlaylist
  // itself does not enqueue metadata. Songs are already committed at this
  // point, so an enqueue failure must not fail the response — log and
  // continue. INSERT OR IGNORE inside enqueueMany makes re-enqueuing the
  // whole round's current URIs harmless.
  if (result.inserted > 0) {
    try {
      const uris = (
        db.prepare(`SELECT spotify_uri FROM ml_submissions WHERE round_id = ?`).all(roundId) as {
          spotify_uri: string;
        }[]
      ).map((r) => r.spotify_uri);
      enqueueMany(db, uris, ['ytm', 'lastfm_pop', 'lastfm_tags', 'lyrics', 'audio']);
    } catch (e) {
      console.error(`voting-lab sync: failed to enqueue metadata for round ${roundId}:`, e);
    }
  }

  let message: string | undefined;
  if (result.inserted === 0 && result.skipped === 0) {
    // ingestPlaylist degrades gracefully (missing Spotify creds, unparseable
    // URL, or a failed fetch) by returning zeros rather than throwing. That's
    // ambiguous with "the playlist is genuinely empty", so surface it rather
    // than silently reporting success.
    message =
      'No tracks were loaded — check that the playlist URL is a valid Spotify playlist link and that Spotify credentials are configured.';
  }

  return json({ ...result, message });
};
