import type Database from 'better-sqlite3';

/**
 * AMA "whole story": the source chat messages behind each hand-written AMA answer.
 * The ama block (digest2_sections) stores only summaries, so the link to the chat is
 * curated here: round → prompt index → answer index → who + chat_messages ids, in
 * telling order. `who` must match the block's answer, so a reordered block shows no
 * story rather than the wrong one. Answers with no entry get no affordance.
 *
 * R168 was mapped by hand from the Boarz chat on 2026-10-23 (p18's keyword matcher
 * found 4 of 12, two of them wrong). Jensen declined and Matt's "cool" answer is the
 * whole message, so neither has an entry.
 */
type Source = { who: string; ids: string[] };
export const AMA_STORY_SOURCES: Record<number, (Source | null)[][]> = {
	168: [
		// "What's your most embarrassing moment?"
		[
			{ who: 'Matt', ids: ['d3ba0cc6-7bcd-4f3b-9534-374f1e2be8c0', '66f77ca7-ea55-4051-820d-e62df4474f9b', '67fa2d60-ee9e-4d4f-8bff-1e00c33db608'] },
			{ who: 'Berto', ids: ['bb963306-0647-477e-8432-5bda1ca35fe3', '55ab3559-f19e-4de6-b51c-1ba27acca9b0', '3b2ed102-9bd2-4c9e-9109-26d0774eb6f9', '75d73b91-99f4-485c-9c69-60d808922ec0'] },
			{ who: 'JB', ids: ['0d7b9921-317c-4065-9058-da7f6ae47804', '777b049b-4e36-478c-b53b-9bd9c3b5f370'] },
			{ who: 'Shane', ids: ['c7b671e8-d533-4002-98d5-eed1eabf68dc', '23209df7-c8a7-422d-9aab-6e4acca95306'] },
			{ who: 'Conor', ids: ['04a45b99-ffe5-4f06-9439-797d412c4b6e'] },
			{ who: 'Clements', ids: ['148f0525-662f-4e0a-9998-6616d47be198'] },
			null,
		],
		// "Tell a story in which you end up seeming cool."
		[
			{ who: 'JB', ids: ['4da5d39b-89d4-47cb-8576-65e9f3df2dce'] },
			{ who: 'Clements', ids: ['0d4c1a27-0853-42af-8b04-5bcb551672d8'] },
			{ who: 'Shane', ids: ['e4c6e588-9fb1-49bc-9df9-f62f30bef2b6'] },
			{ who: 'Conor', ids: ['173cfe1e-6c36-4470-8bdf-574948e86595'] },
			null,
		],
	],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Final text of one chat message. An edited WhatsApp message is captured again with the
 * same sender and ts, so take the newest capture of that (group, sender, ts).
 */
function finalText(db: Database.Database, id: string): string | null {
	const row = db.prepare('SELECT group_name, sender, ts FROM chat_messages WHERE id = ?').get(id) as
		| { group_name: string; sender: string; ts: string }
		| undefined;
	if (!row) return null;
	const latest = db
		.prepare(
			`SELECT text FROM chat_messages WHERE group_name = ? AND sender = ? AND ts = ?
			  ORDER BY captured_at DESC, length(text) DESC LIMIT 1`
		)
		.get(row.group_name, row.sender, row.ts) as { text: string };
	return latest.text.trim() || null;
}

type Answer = { who?: string; summary?: string; story?: string[] };

/** Adds `story` (one paragraph per source message) to each mapped answer. Read-only;
 *  any lookup failure returns the block unchanged so the AMA itself still renders. */
export function attachAmaStories(db: Database.Database, roundId: number, content: unknown): unknown {
	try {
		return withStories(db, roundId, content);
	} catch {
		return content;
	}
}

function withStories(db: Database.Database, roundId: number, content: unknown): unknown {
	const map = AMA_STORY_SOURCES[roundId];
	const c = content as { amas?: { answers?: Answer[] }[] } | null;
	if (!map || !c || !Array.isArray(c.amas)) return content;
	return {
		...c,
		amas: c.amas.map((ama, i) => ({
			...ama,
			answers: (ama.answers ?? []).map((ans, j) => {
				const src = map[i]?.[j];
				if (!src || src.who !== ans.who) return ans;
				const story = src.ids.map((id) => finalText(db, id)).filter((t): t is string => !!t);
				// A story no longer than its summary adds nothing: no affordance.
				if (!story.length || norm(story.join('')).length <= norm(ans.summary ?? '').length) return ans;
				return { ...ans, story };
			}),
		})),
	};
}
