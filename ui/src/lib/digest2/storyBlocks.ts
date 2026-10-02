import type Database from 'better-sqlite3';
import { getActiveDraftForRound, getSectionsForDraft } from '$lib/digest/llm.js';

/** The auto story section kinds digest 2.0 reuses from the 1.0 draft. */
export const AUTO_STORY_KINDS = ['podium', 'villain', 'chat', 'storylines'] as const;
export type AutoStoryKind = (typeof AUTO_STORY_KINDS)[number];

export interface StoryBlock {
	kind: AutoStoryKind;
	content: unknown; // parsed content_json
	variant: string;
}

export interface Digest2Story {
	blocks: StoryBlock[];
	coinage: unknown | null; // parsed stats_content_json.phrase
}

function safeParse(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

/**
 * Read the round's newest 1.0 draft (read-only) and return the auto story
 * blocks + Coinage, in section position order. Never writes; never throws on
 * malformed JSON (the bad block is skipped / coinage falls back to null).
 */
export function buildDigest2StoryBlocks(db: Database.Database, roundId: number): Digest2Story {
	const draft = getActiveDraftForRound(db, roundId);
	if (!draft) return { blocks: [], coinage: null };

	const auto = new Set<string>(AUTO_STORY_KINDS);
	const blocks: StoryBlock[] = [];
	for (const s of getSectionsForDraft(db, draft.id)) {
		if (!auto.has(s.kind) || s.state === 'excluded') continue;
		const content = safeParse(s.content_json);
		if (content == null) continue;
		blocks.push({
			kind: s.kind as AutoStoryKind,
			content,
			variant: (s as { variant?: string }).variant ?? 'both'
		});
	}

	const stats = safeParse(draft.stats_content_json) as { phrase?: unknown } | null;
	const coinage = stats?.phrase ?? null;
	return { blocks, coinage };
}
