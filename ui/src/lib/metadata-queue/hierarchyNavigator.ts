/**
 * hierarchyNavigator.ts — Pure helpers for the hierarchy drill-down navigator.
 *
 * Data-only module (no Svelte) so it stays unit-testable.
 * Constraint: must not import any node-only deps (safe for client bundle).
 */

import type { Scope, HierarchyLeague } from '$lib/db/metadataQueue.js';

// ---------------------------------------------------------------------------
// nodeToScope — convert a tree node level + id into a Scope
// ---------------------------------------------------------------------------

/**
 * Convert a tree level + optional id into a Scope object.
 * For 'all', id is omitted. For league/season/round, id is required.
 */
export function nodeToScope(level: 'all'): { level: 'all' };
export function nodeToScope(level: 'league' | 'season' | 'round', id: number): { level: 'league' | 'season' | 'round'; id: number };
export function nodeToScope(level: Scope['level'], id?: number): Scope {
  if (level === 'all') {
    return { level: 'all' };
  }
  return { level, id: id! };
}

// ---------------------------------------------------------------------------
// roundMatchesQuery — case-insensitive substring predicate
// ---------------------------------------------------------------------------

/**
 * Returns true if the roundName contains the query as a case-insensitive
 * substring. An empty (or whitespace-only) query always returns true.
 */
export function roundMatchesQuery(query: string, roundName: string): boolean {
  const trimmed = query.trim();
  if (trimmed === '') return true;
  return roundName.toLowerCase().includes(trimmed.toLowerCase());
}

// ---------------------------------------------------------------------------
// filterHierarchy — prune hierarchy to rounds matching query, keeping ancestors
// ---------------------------------------------------------------------------

/**
 * Returns a filtered copy of the hierarchy containing only leagues/seasons
 * that have at least one round matching the query.
 * An empty query returns the full hierarchy unchanged.
 */
export function filterHierarchy(hierarchy: HierarchyLeague[], query: string): HierarchyLeague[] {
  const trimmed = query.trim();
  if (trimmed === '') return hierarchy;

  const result: HierarchyLeague[] = [];

  for (const league of hierarchy) {
    const filteredSeasons = [];
    for (const season of league.seasons) {
      const filteredRounds = season.rounds.filter(round =>
        roundMatchesQuery(trimmed, round.name)
      );
      if (filteredRounds.length > 0) {
        filteredSeasons.push({ ...season, rounds: filteredRounds });
      }
    }
    if (filteredSeasons.length > 0) {
      result.push({ ...league, seasons: filteredSeasons });
    }
  }

  return result;
}
