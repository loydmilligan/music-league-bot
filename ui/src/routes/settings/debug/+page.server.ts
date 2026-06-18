import type { PageServerLoad } from './$types.js';
import { getDb } from '$lib/db/client.js';

export const load: PageServerLoad = () => {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('debug_mode') as { value: string } | undefined;
  const debugEnabled = row?.value === 'true';
  return { debugEnabled };
};
