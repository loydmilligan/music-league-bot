import type { RequestHandler } from './$types.js';
import { json } from '@sveltejs/kit';
import { getDb } from '$lib/db/client.js';
import { getThemeHistory } from '$lib/db/themeHistory.js';

// GET /api/history/themes — Tab 2 "Theme research" (sprint-24, theme-data).
// Every past theme/round across all seasons with the songs submitted under it:
// [{ theme, season, round, picks: [{ title, artist, submitter, points }] }].
export const GET: RequestHandler = async () => {
  return json(getThemeHistory(getDb()));
};
