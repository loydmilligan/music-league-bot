import { it, expect, describe } from 'vitest';
import { nodeToScope, roundMatchesQuery, filterHierarchy } from './hierarchyNavigator.js';
import type { HierarchyLeague } from '$lib/db/metadataQueue.js';

// ---------------------------------------------------------------------------
// nodeToScope — maps level + id to a Scope object
// ---------------------------------------------------------------------------

describe('nodeToScope', () => {
  it('level="all" returns {level:"all"} with no id', () => {
    const result = nodeToScope('all');
    expect(result).toEqual({ level: 'all' });
    expect('id' in result).toBe(false);
  });

  it('level="league" with id returns {level:"league", id}', () => {
    const result = nodeToScope('league', 7);
    expect(result).toEqual({ level: 'league', id: 7 });
  });

  it('level="season" with id returns {level:"season", id}', () => {
    const result = nodeToScope('season', 42);
    expect(result).toEqual({ level: 'season', id: 42 });
  });

  it('level="round" with id returns {level:"round", id}', () => {
    const result = nodeToScope('round', 99);
    expect(result).toEqual({ level: 'round', id: 99 });
  });

  it('level="league" id=1 is distinct from id=2', () => {
    const a = nodeToScope('league', 1);
    const b = nodeToScope('league', 2);
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it('level="round" id=0 is valid', () => {
    const result = nodeToScope('round', 0);
    expect(result).toEqual({ level: 'round', id: 0 });
  });
});

// ---------------------------------------------------------------------------
// roundMatchesQuery — case-insensitive substring search predicate
// ---------------------------------------------------------------------------

describe('roundMatchesQuery', () => {
  it('empty query always returns true', () => {
    expect(roundMatchesQuery('', 'Banger Round')).toBe(true);
  });

  it('whitespace-only query returns true', () => {
    expect(roundMatchesQuery('   ', 'Banger Round')).toBe(true);
  });

  it('exact match returns true', () => {
    expect(roundMatchesQuery('Banger Round', 'Banger Round')).toBe(true);
  });

  it('case-insensitive match returns true', () => {
    expect(roundMatchesQuery('banger', 'Banger Round')).toBe(true);
    expect(roundMatchesQuery('BANGER', 'Banger Round')).toBe(true);
    expect(roundMatchesQuery('BaNgEr', 'Banger Round')).toBe(true);
  });

  it('substring match returns true', () => {
    expect(roundMatchesQuery('round', 'Banger Round')).toBe(true);
    expect(roundMatchesQuery('ang', 'Banger Round')).toBe(true);
  });

  it('non-match returns false', () => {
    expect(roundMatchesQuery('metal', 'Banger Round')).toBe(false);
    expect(roundMatchesQuery('xyz', 'Banger Round')).toBe(false);
  });

  it('partial word in name still matches', () => {
    expect(roundMatchesQuery('Bang', 'Banger Round')).toBe(true);
  });

  it('roundName is also case-insensitive on the name side', () => {
    expect(roundMatchesQuery('banger round', 'BANGER ROUND')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// filterHierarchy — prunes hierarchy to matching rounds, keeps ancestors
// ---------------------------------------------------------------------------

describe('filterHierarchy', () => {
  const mockHierarchy: HierarchyLeague[] = [
    {
      id: 1,
      name: 'League A',
      done: 0, pending: 0, processing: 0, failed: 0, total: 0, songCount: 0,
      seasons: [
        {
          id: 10,
          name: 'Season 1',
          done: 0, pending: 0, processing: 0, failed: 0, total: 0, songCount: 0,
          rounds: [
            { id: 100, name: 'Banger Round', songCount: 5, done: 5, pending: 0, processing: 0, failed: 0, total: 5 },
            { id: 101, name: 'Mellow Vibes', songCount: 3, done: 3, pending: 0, processing: 0, failed: 0, total: 3 },
          ],
        },
        {
          id: 11,
          name: 'Season 2',
          done: 0, pending: 0, processing: 0, failed: 0, total: 0, songCount: 0,
          rounds: [
            { id: 102, name: 'Metal Madness', songCount: 8, done: 0, pending: 8, processing: 0, failed: 0, total: 8 },
          ],
        },
      ],
    },
    {
      id: 2,
      name: 'League B',
      done: 0, pending: 0, processing: 0, failed: 0, total: 0, songCount: 0,
      seasons: [
        {
          id: 20,
          name: 'Season 1',
          done: 0, pending: 0, processing: 0, failed: 0, total: 0, songCount: 0,
          rounds: [
            { id: 200, name: 'Jazz Essentials', songCount: 4, done: 4, pending: 0, processing: 0, failed: 0, total: 4 },
          ],
        },
      ],
    },
  ];

  it('empty query returns the full hierarchy unchanged', () => {
    const result = filterHierarchy(mockHierarchy, '');
    expect(result).toHaveLength(2);
    expect(result[0].seasons).toHaveLength(2);
    expect(result[1].seasons).toHaveLength(1);
  });

  it('query matching no rounds returns empty array', () => {
    const result = filterHierarchy(mockHierarchy, 'zzznomatch');
    expect(result).toHaveLength(0);
  });

  it('query matching one round keeps only that round and its ancestors', () => {
    const result = filterHierarchy(mockHierarchy, 'metal');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
    expect(result[0].seasons).toHaveLength(1);
    expect(result[0].seasons[0].id).toBe(11);
    expect(result[0].seasons[0].rounds).toHaveLength(1);
    expect(result[0].seasons[0].rounds[0].name).toBe('Metal Madness');
  });

  it('query matching rounds in two leagues keeps both leagues', () => {
    const result = filterHierarchy(mockHierarchy, 'round');
    // "Banger Round" matches
    expect(result.some(l => l.id === 1)).toBe(true);
    // "Jazz Essentials" does not match "round", so League B dropped
    expect(result.some(l => l.id === 2)).toBe(false);
  });

  it('case-insensitive filtering works in filterHierarchy', () => {
    const result = filterHierarchy(mockHierarchy, 'JAZZ');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
    expect(result[0].seasons[0].rounds[0].name).toBe('Jazz Essentials');
  });

  it('non-matching season is pruned even when its league has another matching season', () => {
    const result = filterHierarchy(mockHierarchy, 'mellow');
    expect(result).toHaveLength(1);
    expect(result[0].seasons).toHaveLength(1);
    expect(result[0].seasons[0].id).toBe(10);
    expect(result[0].seasons[0].rounds).toHaveLength(1);
    expect(result[0].seasons[0].rounds[0].name).toBe('Mellow Vibes');
  });
});
