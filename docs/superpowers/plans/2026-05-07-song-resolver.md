# Song Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a pure `resolveTrack()` function that converts a `ParsedSubmission` into a `ResolutionResult` (track + status + query), and extend the config schema with a `notifications` block including a configurable confidence threshold.

**Architecture:** Two source files (`src/resolver/types.ts` and `src/resolver/resolveTrack.ts`) plus a config schema extension. The resolver is a pure function injected with an `ISpotifyAdapter` — no side effects, no notification dispatch. URL parsing handles both HTTPS and URI Spotify formats. Text queries go through `searchTrack()`; confidence vs. threshold determines `found` vs. `low-confidence`.

**Tech Stack:** TypeScript (strict, NodeNext ESM), Zod (config schema), Vitest (tests).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/resolver/types.ts` | Create | `ResolutionStatus`, `ResolutionResult` types |
| `src/resolver/resolveTrack.ts` | Create | `resolveTrack()` pure function |
| `src/config/types.ts` | Modify | Add `notificationsSchema` + `notifications` field to `rulesConfigSchema` |
| `config/rules.example.json` | Modify | Add example `notifications` block |
| `tests/resolver.test.ts` | Create | Unit tests with mocked `ISpotifyAdapter` |

---

### Task 1: Types + config schema extension

**Files:**
- Create: `src/resolver/types.ts`
- Modify: `src/config/types.ts`
- Modify: `config/rules.example.json`

- [ ] **Step 1: Create `src/resolver/types.ts`**

```typescript
import type { ResolvedTrack } from '../music/types.js';

export type ResolutionStatus = 'found' | 'low-confidence' | 'not-found';

export interface ResolutionResult {
  track: ResolvedTrack | null;
  status: ResolutionStatus;
  query: string;
}
```

- [ ] **Step 2: Extend `src/config/types.ts` with the notifications schema**

Replace the entire file with:

```typescript
import { z } from 'zod';

export const ruleWhenSchema = z.object({
  command: z.string().optional(),
  tag: z.string().optional(),
  submittedBy: z.string().optional(),
  groupId: z.string().optional(),
});

export const rulePlaylistSchema = z.object({
  spotify: z.string().optional(),
  youtube: z.string().optional(),
});

export const ruleSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  when: ruleWhenSchema,
  playlist: rulePlaylistSchema,
});

export const notificationsSchema = z.object({
  onFailure: z.boolean().default(true),
  onLowConfidence: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(1).default(0.9),
  recipients: z.enum(['me', 'submitter', 'me-and-submitter']).default('me'),
});

export const rulesConfigSchema = z.object({
  defaults: z.object({
    requireCommandPrefix: z.boolean().optional(),
    commandPrefix: z.string().optional(),
    dedupeScope: z.enum(['playlist', 'global', 'week']).optional(),
  }),
  rules: z.array(ruleSchema),
  notifications: notificationsSchema.optional(),
});

export type RuleWhen = z.infer<typeof ruleWhenSchema>;
export type RulePlaylist = z.infer<typeof rulePlaylistSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Notifications = z.infer<typeof notificationsSchema>;
export type RulesConfig = z.infer<typeof rulesConfigSchema>;
```

- [ ] **Step 3: Add `notifications` block to `config/rules.example.json`**

Replace the file with:

```json
{
  "defaults": {
    "requireCommandPrefix": true,
    "commandPrefix": "!song",
    "dedupeScope": "playlist"
  },
  "notifications": {
    "onFailure": true,
    "onLowConfidence": true,
    "confidenceThreshold": 0.9,
    "recipients": "me"
  },
  "rules": [
    {
      "name": "Current weekly playlist",
      "enabled": true,
      "when": {
        "command": "song"
      },
      "playlist": {
        "spotify": "Music League - Week {{weekNumber}}",
        "youtube": "Music League - Week {{weekNumber}}"
      }
    },
    {
      "name": "Summer tag playlist",
      "enabled": true,
      "when": {
        "tag": "summer"
      },
      "playlist": {
        "spotify": "Music League - Summer",
        "youtube": "Music League - Summer"
      }
    },
    {
      "name": "Per submitter playlist",
      "enabled": false,
      "when": {
        "submittedBy": "*"
      },
      "playlist": {
        "spotify": "Music League - {{submittedBy}}"
      }
    }
  ]
}
```

- [ ] **Step 4: Run existing tests to confirm no regressions**

```bash
npm test
```

Expected: all 58 tests pass (7 integration skipped if no token).

- [ ] **Step 5: Commit**

```bash
git add src/resolver/types.ts src/config/types.ts config/rules.example.json
git commit -m "feat: add ResolutionResult types and notifications config schema"
```

---

### Task 2: resolveTrack() + full test suite

**Files:**
- Create: `tests/resolver.test.ts`
- Create: `src/resolver/resolveTrack.ts`

- [ ] **Step 1: Write `tests/resolver.test.ts`**

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ISpotifyAdapter } from '../src/music/types.js';
import { resolveTrack } from '../src/resolver/resolveTrack.js';
import type { ParsedSubmission } from '../src/parser/types.js';

function makeSubmission(overrides: Partial<ParsedSubmission> = {}): ParsedSubmission {
  return {
    command: 'song',
    rawText: '',
    sourceUrl: null,
    artistHint: null,
    titleHint: null,
    tags: [],
    ...overrides,
  };
}

const resolvedTrack = {
  title: 'No Ordinary Love',
  artist: 'Sade',
  album: 'Love Deluxe',
  durationMs: 290000,
  spotifyTrackId: 'track1',
  spotifyUri: 'spotify:track:track1',
  sourceUrl: 'https://open.spotify.com/track/track1',
  confidence: 1.0,
};

function makeMockAdapter(overrides: Partial<ISpotifyAdapter> = {}): ISpotifyAdapter {
  return {
    searchTrack: vi.fn().mockResolvedValue(null),
    getTrackById: vi.fn().mockResolvedValue(null),
    findOrCreatePlaylist: vi.fn(),
    addTrackToPlaylist: vi.fn(),
    isTrackInPlaylist: vi.fn(),
    ...overrides,
  };
}

describe('resolveTrack — Spotify HTTPS URL', () => {
  it('extracts track ID and returns found status', async () => {
    const adapter = makeMockAdapter({
      getTrackById: vi.fn().mockResolvedValue(resolvedTrack),
    });
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7?si=abc' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('found');
    expect(result.track).toBe(resolvedTrack);
    expect(result.query).toBe('https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7?si=abc');
    expect(adapter.getTrackById).toHaveBeenCalledWith('4LRPiXqCikLlN15c3yImP7');
  });

  it('returns not-found when adapter returns null for a Spotify URL', async () => {
    const adapter = makeMockAdapter({ getTrackById: vi.fn().mockResolvedValue(null) });
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
  });
});

describe('resolveTrack — Spotify URI', () => {
  it('extracts track ID from spotify:track: URI and returns found', async () => {
    const adapter = makeMockAdapter({
      getTrackById: vi.fn().mockResolvedValue(resolvedTrack),
    });
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'spotify:track:4LRPiXqCikLlN15c3yImP7' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('found');
    expect(adapter.getTrackById).toHaveBeenCalledWith('4LRPiXqCikLlN15c3yImP7');
  });
});

describe('resolveTrack — YouTube URL', () => {
  it('returns not-found with youtube stub message for youtube.com URLs', async () => {
    const adapter = makeMockAdapter();
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
    expect(result.query).toContain('YouTube');
    expect(adapter.getTrackById).not.toHaveBeenCalled();
    expect(adapter.searchTrack).not.toHaveBeenCalled();
  });

  it('returns not-found for youtu.be short URLs', async () => {
    const adapter = makeMockAdapter();
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.query).toContain('YouTube');
  });
});

describe('resolveTrack — other URL', () => {
  it('returns not-found for an unrecognised URL', async () => {
    const adapter = makeMockAdapter();
    const result = await resolveTrack(
      makeSubmission({ sourceUrl: 'https://soundcloud.com/artist/track' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
    expect(adapter.searchTrack).not.toHaveBeenCalled();
  });
});

describe('resolveTrack — text search', () => {
  it('returns found when confidence >= threshold', async () => {
    const highConfidenceTrack = { ...resolvedTrack, confidence: 0.9 };
    const adapter = makeMockAdapter({
      searchTrack: vi.fn().mockResolvedValue(highConfidenceTrack),
    });
    const result = await resolveTrack(
      makeSubmission({ artistHint: 'Sade', titleHint: 'No Ordinary Love' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('found');
    expect(result.track).toBe(highConfidenceTrack);
    expect(result.query).toBe('Sade - No Ordinary Love');
    expect(adapter.searchTrack).toHaveBeenCalledWith('Sade - No Ordinary Love');
  });

  it('returns low-confidence when confidence < threshold', async () => {
    const lowConfidenceTrack = { ...resolvedTrack, confidence: 0.8 };
    const adapter = makeMockAdapter({
      searchTrack: vi.fn().mockResolvedValue(lowConfidenceTrack),
    });
    const result = await resolveTrack(
      makeSubmission({ artistHint: 'Sade', titleHint: 'No Ordinary Love' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('low-confidence');
    expect(result.track).toBe(lowConfidenceTrack);
  });

  it('returns not-found when searchTrack returns null', async () => {
    const adapter = makeMockAdapter({ searchTrack: vi.fn().mockResolvedValue(null) });
    const result = await resolveTrack(
      makeSubmission({ artistHint: 'Unknown', titleHint: 'Song' }),
      adapter,
      0.9,
    );
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
  });
});

describe('resolveTrack — no input', () => {
  it('returns not-found when no URL and no artist/title hints', async () => {
    const adapter = makeMockAdapter();
    const result = await resolveTrack(makeSubmission(), adapter, 0.9);
    expect(result.status).toBe('not-found');
    expect(result.track).toBeNull();
    expect(result.query).toBe('');
    expect(adapter.searchTrack).not.toHaveBeenCalled();
    expect(adapter.getTrackById).not.toHaveBeenCalled();
  });
});

describe('resolveTrack — error propagation', () => {
  it('propagates errors thrown by the adapter', async () => {
    const adapter = makeMockAdapter({
      getTrackById: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    await expect(
      resolveTrack(
        makeSubmission({ sourceUrl: 'https://open.spotify.com/track/4LRPiXqCikLlN15c3yImP7' }),
        adapter,
        0.9,
      ),
    ).rejects.toThrow('Network error');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/resolver.test.ts
```

Expected: `Cannot find module '../src/resolver/resolveTrack.js'`

- [ ] **Step 3: Create `src/resolver/resolveTrack.ts`**

```typescript
import type { ISpotifyAdapter } from '../music/types.js';
import type { ParsedSubmission } from '../parser/types.js';
import type { ResolutionResult } from './types.js';

const SPOTIFY_HTTPS_RE = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/;
const SPOTIFY_URI_RE = /^spotify:track:([A-Za-z0-9]+)$/;
const YOUTUBE_RE = /(?:youtube\.com\/watch|youtu\.be\/)/;

export async function resolveTrack(
  submission: ParsedSubmission,
  adapter: ISpotifyAdapter,
  confidenceThreshold: number,
): Promise<ResolutionResult> {
  const { sourceUrl, artistHint, titleHint } = submission;

  if (sourceUrl) {
    const spotifyHttpsMatch = sourceUrl.match(SPOTIFY_HTTPS_RE);
    if (spotifyHttpsMatch) {
      const track = await adapter.getTrackById(spotifyHttpsMatch[1]);
      return {
        track,
        status: track ? 'found' : 'not-found',
        query: sourceUrl,
      };
    }

    const spotifyUriMatch = sourceUrl.match(SPOTIFY_URI_RE);
    if (spotifyUriMatch) {
      const track = await adapter.getTrackById(spotifyUriMatch[1]);
      return {
        track,
        status: track ? 'found' : 'not-found',
        query: sourceUrl,
      };
    }

    if (YOUTUBE_RE.test(sourceUrl)) {
      return {
        track: null,
        status: 'not-found',
        query: `YouTube links are not yet supported: ${sourceUrl}`,
      };
    }

    return { track: null, status: 'not-found', query: sourceUrl };
  }

  if (artistHint && titleHint) {
    const query = `${artistHint} - ${titleHint}`;
    const track = await adapter.searchTrack(query);
    if (!track) return { track: null, status: 'not-found', query };
    const status = track.confidence >= confidenceThreshold ? 'found' : 'low-confidence';
    return { track, status, query };
  }

  return { track: null, status: 'not-found', query: '' };
}
```

- [ ] **Step 4: Run resolver tests to confirm they pass**

```bash
npm test -- tests/resolver.test.ts
```

Expected: PASS (10 tests)

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
npm test
```

Expected: 68 tests pass (58 existing + 10 new), 7 integration skipped.

- [ ] **Step 6: Commit**

```bash
git add src/resolver/resolveTrack.ts tests/resolver.test.ts
git commit -m "feat: add resolveTrack() with Spotify URL parsing and confidence threshold"
```

---

## Self-Review

**Spec coverage:**
- [x] `ResolutionResult` type with `track`, `status`, `query` — Task 1
- [x] `notifications` config schema with `onFailure`, `onLowConfidence`, `confidenceThreshold`, `recipients` — Task 1
- [x] Spotify HTTPS URL → `getTrackById` → `found` — Task 2
- [x] Spotify URI format → `getTrackById` → `found` — Task 2
- [x] YouTube URL → `not-found` with stub message — Task 2
- [x] Other URL → `not-found` — Task 2
- [x] Text search, confidence ≥ threshold → `found` — Task 2
- [x] Text search, confidence < threshold → `low-confidence` — Task 2
- [x] Text search returns null → `not-found` — Task 2
- [x] No URL, no hints → `not-found` — Task 2
- [x] Adapter throws → error propagates — Task 2
- [x] `rules.example.json` updated with notifications block — Task 1

**Placeholder scan:** None. All code blocks are complete.

**Type consistency:**
- `ResolutionResult` defined in `src/resolver/types.ts`, used in `resolveTrack.ts` return type ✓
- `ResolutionStatus` `'found' | 'low-confidence' | 'not-found'` used consistently ✓
- `ISpotifyAdapter` from `src/music/types.ts` ✓
- `ParsedSubmission` from `src/parser/types.ts` ✓
- `notificationsSchema` / `Notifications` exported from `src/config/types.ts` ✓
