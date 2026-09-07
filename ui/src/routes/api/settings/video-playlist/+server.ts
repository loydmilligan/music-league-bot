import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import {
  getVideoPlaylistDefaults,
  updateVideoPlaylistDefaults,
  RECOMMENDED_AUTO_ACCEPT_PCT,
  type VideoPlaylistConfig,
} from '$lib/db/videoPlaylist.js';

// GET /api/settings/video-playlist → { config, recommendedPct }
// These are the DEFAULTS every round inherits until it overrides them.
export const GET: RequestHandler = () => {
  return json({ config: getVideoPlaylistDefaults(getDb()), recommendedPct: RECOMMENDED_AUTO_ACCEPT_PCT });
};

// PUT /api/settings/video-playlist  body: { config: Partial<VideoPlaylistConfig> }
// Partial by design — the UI saves one toggle at a time. Returns the merged,
// normalized value that was stored.
export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { config?: unknown } | null;
  if (!body || typeof body.config !== 'object' || body.config === null) {
    throw error(400, 'body.config must be an object');
  }
  const saved = updateVideoPlaylistDefaults(getDb(), body.config as Partial<VideoPlaylistConfig>);
  return json({ config: saved, recommendedPct: RECOMMENDED_AUTO_ACCEPT_PCT });
};
