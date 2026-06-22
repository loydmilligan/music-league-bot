import type { PageServerLoad, Actions } from './$types.js';
import { getDb } from '$lib/db/client.js';
import { getChatSettings, saveChatSettings, getAllDistinctSenders, getChatGroups } from '$lib/chat/historyQuery.js';
import { getAllLeagues } from '$lib/db/leagues.js';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const settings = getChatSettings(db);
  const senders = getAllDistinctSenders(db);
  const groups = getChatGroups(db);
  const leagues = getAllLeagues(db);
  return { settings, senders, groups, leagues };
};

export const actions: Actions = {
  saveChatSettings: async ({ request }) => {
    const data = await request.formData();
    const db = getDb();
    const current = getChatSettings(db);

    const selfNamesRaw = (data.get('self_names') as string | null) ?? '';
    const selfNames = selfNamesRaw.split('\n').map(s => s.trim()).filter(Boolean);
    const roundBoundary = (data.get('round_boundary') as string) === 'buffer' ? 'buffer' : 'strict';
    const bufferDays = Math.min(3, Math.max(1, parseInt((data.get('buffer_days') as string) ?? '1', 10)));

    // League→group mapping: form fields named league_group_{slug}
    const leagueGroupMap: Record<string, string> = { ...current.leagueGroupMap };
    for (const [key, value] of data.entries()) {
      if (key.startsWith('league_group_')) {
        const slug = key.replace('league_group_', '');
        leagueGroupMap[slug] = (value as string).trim();
      }
    }

    try {
      saveChatSettings(db, { selfNames, roundBoundary, bufferDays, leagueGroupMap });
    } catch (e) {
      return fail(500, { error: String(e) });
    }

    return { success: true };
  },
};
