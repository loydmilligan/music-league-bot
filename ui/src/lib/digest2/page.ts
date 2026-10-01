import type Database from 'better-sqlite3';
import type { Snapshot, StatsSelection } from '$lib/server/boarzStats/data.js';
import { buildStatsEmbedForRound } from './statsEmbed.js';
import { buildDigest2StoryBlocks, type Digest2Story } from './storyBlocks.js';

export interface Digest2Page {
	roundId: number;
	snapshot: Snapshot;
	story: Digest2Story;
}

/** Assemble the read-only digest 2.0 page: stats embed (Phase ①) + reused 1.0 story blocks. */
export function buildDigest2Page(
	db: Database.Database,
	roundId: number,
	buildSnapshot: (selection: StatsSelection) => Snapshot
): Digest2Page {
	const { snapshot } = buildStatsEmbedForRound(db, roundId, buildSnapshot);
	const story = buildDigest2StoryBlocks(db, roundId);
	return { roundId, snapshot, story };
}
