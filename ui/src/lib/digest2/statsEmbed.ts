import type Database from 'better-sqlite3';
import type { Snapshot, StatsSelection } from '$lib/server/boarzStats/data.js';
import { resolveStatsSelectionForRound } from './statsSelection.js';

/**
 * Build the read-only stats embed for a round: resolve its own-season selection
 * and hand it to the (injected) snapshot builder. Throws if the round is unknown.
 */
export function buildStatsEmbedForRound(
	db: Database.Database,
	roundId: number,
	buildSnapshot: (selection: StatsSelection) => Snapshot
): { roundId: number; snapshot: Snapshot } {
	const selection = resolveStatsSelectionForRound(db, roundId);
	if (!selection) throw new Error(`round ${roundId} not found`);
	return { roundId, snapshot: buildSnapshot(selection) };
}
