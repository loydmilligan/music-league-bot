# Music League Bot – Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement config loading, message parsing, and rules evaluation with full unit tests — no external API calls, no WhatsApp, no database.

**Architecture:** Three pure modules (config loader, parser, rules engine) communicate through typed interfaces. The config loader reads `config/rules.json` via Zod-validated parsing. The parser turns raw `!song` text into a `ParsedSubmission`. The rules engine evaluates that submission against loaded rules and returns resolved playlist targets with template variables expanded. Adapter interfaces for Spotify and YouTube are declared but not implemented.

**Tech Stack:** TypeScript 5 (strict, NodeNext module resolution), Zod for config validation, Vitest for tests.

---

### File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/config/types.ts` | Create | Zod schemas + exported TypeScript types for `rules.json` |
| `src/config/loader.ts` | Create | `parseConfig(raw)` and `loadConfig(path)` |
| `src/parser/types.ts` | Create | `ParsedSubmission` interface |
| `src/parser/parseMessage.ts` | Create | `parseMessage(text)` pure function |
| `src/rules/types.ts` | Create | `TemplateContext` and `RuleMatch` interfaces |
| `src/rules/templates.ts` | Create | `resolveTemplate()` and `getISOWeekNumber()` |
| `src/rules/engine.ts` | Create | `applyRules(config, submission, context)` pure function |
| `src/music/types.ts` | Create | `ResolvedTrack`, `ISpotifyAdapter`, `IYouTubeAdapter` interfaces |
| `src/index.ts` | Modify | Demo entrypoint wiring parser + rules |
| `tests/config.test.ts` | Create | Config schema + loader tests |
| `tests/parser.test.ts` | Create | Full parser tests |
| `tests/rules.test.ts` | Create | Template + engine tests |
| `tests/fixtures/rules.test.json` | Create | Fixture config for loader tests |
| `tests/parser.placeholder.test.ts` | Delete | Replace with real tests |
| `README.md` | Modify | Add "Running tests" section |

**Import note:** This project uses `"type": "module"` + `"moduleResolution": "NodeNext"`. All relative TypeScript imports must use `.js` extensions (e.g., `import { foo } from './foo.js'`). Vitest resolves these to `.ts` at test time.

---

### Task 1: Config types and Zod schemas

**Files:**
- Create: `src/config/types.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write failing config schema test**

Create `tests/config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { rulesConfigSchema } from '../src/config/types.js';

describe('rulesConfigSchema', () => {
  it('parses a valid config', () => {
    const raw = {
      defaults: { requireCommandPrefix: true, commandPrefix: '!song', dedupeScope: 'playlist' },
      rules: [
        {
          name: 'Test rule',
          enabled: true,
          when: { command: 'song' },
          playlist: { spotify: 'Test Playlist' },
        },
      ],
    };
    const result = rulesConfigSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rules[0].name).toBe('Test rule');
    }
  });

  it('rejects a config missing rules array', () => {
    const result = rulesConfigSchema.safeParse({ defaults: {}, rules: 'bad' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npm test -- tests/config.test.ts
```
Expected: error `Cannot find module '../src/config/types.js'`

- [ ] **Step 3: Create `src/config/types.ts`**

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

export const rulesConfigSchema = z.object({
  defaults: z.object({
    requireCommandPrefix: z.boolean().optional(),
    commandPrefix: z.string().optional(),
    dedupeScope: z.enum(['playlist', 'global', 'week']).optional(),
  }),
  rules: z.array(ruleSchema),
});

export type RuleWhen = z.infer<typeof ruleWhenSchema>;
export type RulePlaylist = z.infer<typeof rulePlaylistSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type RulesConfig = z.infer<typeof rulesConfigSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```
npm test -- tests/config.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config/types.ts tests/config.test.ts
git commit -m "feat: add config Zod schema and types"
```

---

### Task 2: Config loader

**Files:**
- Create: `src/config/loader.ts`
- Create: `tests/fixtures/rules.test.json`
- Modify: `tests/config.test.ts` (append loader tests)

- [ ] **Step 1: Create test fixture `tests/fixtures/rules.test.json`**

```json
{
  "defaults": {
    "requireCommandPrefix": true,
    "commandPrefix": "!song",
    "dedupeScope": "playlist"
  },
  "rules": [
    {
      "name": "Weekly playlist",
      "enabled": true,
      "when": { "command": "song" },
      "playlist": { "spotify": "Music League - Week {{weekNumber}}" }
    }
  ]
}
```

- [ ] **Step 2: Append loader tests to `tests/config.test.ts`**

```typescript
import { loadConfig, parseConfig } from '../src/config/loader.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('parseConfig', () => {
  it('returns typed config from plain object', () => {
    const raw = {
      defaults: { requireCommandPrefix: true, commandPrefix: '!song', dedupeScope: 'playlist' as const },
      rules: [{ name: 'r', enabled: true, when: { command: 'song' }, playlist: { spotify: 'P' } }],
    };
    const config = parseConfig(raw);
    expect(config.rules).toHaveLength(1);
    expect(config.rules[0].name).toBe('r');
  });

  it('throws on invalid config', () => {
    expect(() => parseConfig({ rules: 'bad' })).toThrow();
  });
});

describe('loadConfig', () => {
  it('loads and validates config from a JSON file', () => {
    const fixturePath = path.join(__dirname, 'fixtures/rules.test.json');
    const config = loadConfig(fixturePath);
    expect(config.rules[0].name).toBe('Weekly playlist');
    expect(config.rules[0].playlist.spotify).toBe('Music League - Week {{weekNumber}}');
  });

  it('throws when file does not exist', () => {
    expect(() => loadConfig('/nonexistent/rules.json')).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify the new tests fail**

```
npm test -- tests/config.test.ts
```
Expected: error `Cannot find module '../src/config/loader.js'`

- [ ] **Step 4: Create `src/config/loader.ts`**

```typescript
import { readFileSync } from 'node:fs';
import { rulesConfigSchema, type RulesConfig } from './types.js';

export function parseConfig(raw: unknown): RulesConfig {
  return rulesConfigSchema.parse(raw);
}

export function loadConfig(configPath: string): RulesConfig {
  const text = readFileSync(configPath, 'utf-8');
  return parseConfig(JSON.parse(text));
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npm test -- tests/config.test.ts
```
Expected: PASS (all 6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/config/loader.ts tests/config.test.ts tests/fixtures/rules.test.json
git commit -m "feat: add config loader with Zod validation"
```

---

### Task 3: Parser types and parseMessage function

**Files:**
- Create: `src/parser/types.ts`
- Create: `src/parser/parseMessage.ts`
- Create: `tests/parser.test.ts`
- Delete: `tests/parser.placeholder.test.ts`

- [ ] **Step 1: Write failing parser tests in `tests/parser.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { parseMessage } from '../src/parser/parseMessage.js';

describe('parseMessage', () => {
  it('returns null for messages not starting with !song', () => {
    expect(parseMessage('hello world')).toBeNull();
    expect(parseMessage('https://open.spotify.com/track/xxx')).toBeNull();
    expect(parseMessage('')).toBeNull();
  });

  it('returns null for unknown commands', () => {
    expect(parseMessage('!help')).toBeNull();
    expect(parseMessage('!playlist something')).toBeNull();
  });

  it('parses a Spotify URL', () => {
    const result = parseMessage('!song https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh');
    expect(result).toEqual({
      command: 'song',
      rawText: '!song https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
      sourceUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
      artistHint: null,
      titleHint: null,
      tags: [],
    });
  });

  it('parses a Spotify URL with query params', () => {
    const result = parseMessage('!song https://open.spotify.com/track/xxx?si=abc123');
    expect(result?.sourceUrl).toBe('https://open.spotify.com/track/xxx?si=abc123');
    expect(result?.tags).toEqual([]);
  });

  it('parses a YouTube URL', () => {
    const result = parseMessage('!song https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result?.sourceUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('parses a Spotify URL followed by a tag', () => {
    const result = parseMessage('!song https://open.spotify.com/track/xxx #summer');
    expect(result?.sourceUrl).toBe('https://open.spotify.com/track/xxx');
    expect(result?.tags).toEqual(['summer']);
  });

  it('parses plain text artist - title', () => {
    const result = parseMessage('!song Sade - No Ordinary Love');
    expect(result).toEqual({
      command: 'song',
      rawText: '!song Sade - No Ordinary Love',
      sourceUrl: null,
      artistHint: 'Sade',
      titleHint: 'No Ordinary Love',
      tags: [],
    });
  });

  it('parses artist - title with a single tag', () => {
    const result = parseMessage('!song The Beths - Expert in a Dying Field #week7');
    expect(result?.artistHint).toBe('The Beths');
    expect(result?.titleHint).toBe('Expert in a Dying Field');
    expect(result?.tags).toEqual(['week7']);
  });

  it('parses artist - title with multiple tags', () => {
    const result = parseMessage('!song Artist - Title #summer #finals');
    expect(result?.artistHint).toBe('Artist');
    expect(result?.titleHint).toBe('Title');
    expect(result?.tags).toEqual(['summer', 'finals']);
  });

  it('is case-insensitive for the command', () => {
    const result = parseMessage('!Song https://open.spotify.com/track/xxx');
    expect(result?.command).toBe('song');
  });

  it('handles leading/trailing whitespace on the full message', () => {
    const result = parseMessage('  !song Sade - No Ordinary Love  ');
    expect(result?.artistHint).toBe('Sade');
    expect(result?.titleHint).toBe('No Ordinary Love');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npm test -- tests/parser.test.ts
```
Expected: error `Cannot find module '../src/parser/parseMessage.js'`

- [ ] **Step 3: Create `src/parser/types.ts`**

```typescript
export interface ParsedSubmission {
  command: string;
  rawText: string;
  sourceUrl: string | null;
  artistHint: string | null;
  titleHint: string | null;
  tags: string[];
}
```

- [ ] **Step 4: Create `src/parser/parseMessage.ts`**

```typescript
import type { ParsedSubmission } from './types.js';

const COMMAND_RE = /^!(\w+)\s+([\s\S]+)$/;
const URL_RE = /^(https?:\/\/\S+)/;

export function parseMessage(text: string): ParsedSubmission | null {
  const trimmed = text.trim();
  const commandMatch = trimmed.match(COMMAND_RE);
  if (!commandMatch) return null;

  const command = commandMatch[1].toLowerCase();
  if (command !== 'song') return null;

  const body = commandMatch[2].trim();
  const tags = Array.from(body.matchAll(/#(\w+)/g)).map((m) => m[1]);

  const urlMatch = body.match(URL_RE);
  if (urlMatch) {
    return { command, rawText: trimmed, sourceUrl: urlMatch[1], artistHint: null, titleHint: null, tags };
  }

  const bodyWithoutTags = body.replace(/#\w+/g, '').trim();
  const artistTitleMatch = bodyWithoutTags.match(/^(.+?)\s+-\s+(.+)$/);
  if (artistTitleMatch) {
    return {
      command,
      rawText: trimmed,
      sourceUrl: null,
      artistHint: artistTitleMatch[1].trim(),
      titleHint: artistTitleMatch[2].trim(),
      tags,
    };
  }

  return { command, rawText: trimmed, sourceUrl: null, artistHint: null, titleHint: null, tags };
}
```

- [ ] **Step 5: Delete the placeholder test**

```bash
rm tests/parser.placeholder.test.ts
```

- [ ] **Step 6: Run tests to verify they pass**

```
npm test -- tests/parser.test.ts
```
Expected: PASS (11 tests)

- [ ] **Step 7: Commit**

```bash
git add src/parser/types.ts src/parser/parseMessage.ts tests/parser.test.ts
git rm tests/parser.placeholder.test.ts
git commit -m "feat: add message parser with full test suite"
```

---

### Task 4: Template resolver

**Files:**
- Create: `src/rules/types.ts`
- Create: `src/rules/templates.ts`
- Create: `tests/rules.test.ts`

- [ ] **Step 1: Write failing template tests in `tests/rules.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveTemplate, getISOWeekNumber } from '../src/rules/templates.js';

describe('getISOWeekNumber', () => {
  it('returns 1 for 2026-01-01 (Thursday)', () => {
    expect(getISOWeekNumber(new Date('2026-01-01'))).toBe(1);
  });

  it('returns 2 for 2026-01-05 (Monday of week 2)', () => {
    expect(getISOWeekNumber(new Date('2026-01-05'))).toBe(2);
  });
});

describe('resolveTemplate', () => {
  it('replaces {{weekNumber}}', () => {
    expect(resolveTemplate('Week {{weekNumber}}', { weekNumber: 7, year: 2026 })).toBe('Week 7');
  });

  it('replaces {{year}}', () => {
    expect(resolveTemplate('List {{year}}', { weekNumber: 1, year: 2026 })).toBe('List 2026');
  });

  it('replaces {{submittedBy}}', () => {
    expect(
      resolveTemplate('{{submittedBy}} Picks', { weekNumber: 1, year: 2026, submittedBy: 'Alice' }),
    ).toBe('Alice Picks');
  });

  it('replaces {{tag}}', () => {
    expect(resolveTemplate('Tag: {{tag}}', { weekNumber: 1, year: 2026, tag: 'summer' })).toBe(
      'Tag: summer',
    );
  });

  it('replaces optional variables with empty string when absent', () => {
    expect(resolveTemplate('{{submittedBy}} Picks', { weekNumber: 1, year: 2026 })).toBe(' Picks');
  });

  it('passes through strings with no template variables', () => {
    expect(resolveTemplate('Static Playlist', { weekNumber: 7, year: 2026 })).toBe(
      'Static Playlist',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npm test -- tests/rules.test.ts
```
Expected: error `Cannot find module '../src/rules/templates.js'`

- [ ] **Step 3: Create `src/rules/types.ts`**

```typescript
export interface TemplateContext {
  weekNumber: number;
  year: number;
  submittedBy?: string;
  tag?: string;
  groupName?: string;
}

export interface RuleMatch {
  name: string;
  spotify?: string;
  youtube?: string;
}
```

- [ ] **Step 4: Create `src/rules/templates.ts`**

```typescript
import type { TemplateContext } from './types.js';

export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function resolveTemplate(template: string, context: TemplateContext): string {
  return template
    .replace(/\{\{weekNumber\}\}/g, String(context.weekNumber))
    .replace(/\{\{year\}\}/g, String(context.year))
    .replace(/\{\{submittedBy\}\}/g, context.submittedBy ?? '')
    .replace(/\{\{tag\}\}/g, context.tag ?? '')
    .replace(/\{\{groupName\}\}/g, context.groupName ?? '');
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npm test -- tests/rules.test.ts
```
Expected: PASS (8 tests)

- [ ] **Step 6: Commit**

```bash
git add src/rules/types.ts src/rules/templates.ts tests/rules.test.ts
git commit -m "feat: add template resolver and context types"
```

---

### Task 5: Rules engine

**Files:**
- Create: `src/rules/engine.ts`
- Modify: `tests/rules.test.ts` (append engine tests)

- [ ] **Step 1: Append engine tests to `tests/rules.test.ts`**

```typescript
import { applyRules } from '../src/rules/engine.js';
import type { RulesConfig } from '../src/config/types.js';

const testConfig: RulesConfig = {
  defaults: { requireCommandPrefix: true, commandPrefix: '!song', dedupeScope: 'playlist' },
  rules: [
    {
      name: 'Weekly playlist',
      enabled: true,
      when: { command: 'song' },
      playlist: { spotify: 'Music League - Week {{weekNumber}}' },
    },
    {
      name: 'Summer tag',
      enabled: true,
      when: { tag: 'summer' },
      playlist: { spotify: 'Music League - Summer', youtube: 'Music League - Summer YT' },
    },
    {
      name: 'Per submitter',
      enabled: true,
      when: { submittedBy: '*' },
      playlist: { spotify: 'Music League - {{submittedBy}}' },
    },
    {
      name: 'Disabled rule',
      enabled: false,
      when: { command: 'song' },
      playlist: { spotify: 'Should Not Appear' },
    },
  ],
};

describe('applyRules', () => {
  it('matches a command rule and resolves the weekNumber template', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: [] },
      { weekNumber: 7, year: 2026 },
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Weekly playlist');
    expect(matches[0].spotify).toBe('Music League - Week 7');
  });

  it('matches both command rule and tag rule when tag is present', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: ['summer'] },
      { weekNumber: 7, year: 2026 },
    );
    const names = matches.map((m) => m.name);
    expect(names).toContain('Weekly playlist');
    expect(names).toContain('Summer tag');
    expect(matches.find((m) => m.name === 'Summer tag')?.youtube).toBe('Music League - Summer YT');
  });

  it('skips disabled rules even when they would match', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: [] },
      { weekNumber: 7, year: 2026 },
    );
    expect(matches.every((m) => m.name !== 'Disabled rule')).toBe(true);
  });

  it('matches wildcard submittedBy when submittedBy is provided', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: [], submittedBy: 'Alice' },
      { weekNumber: 7, year: 2026, submittedBy: 'Alice' },
    );
    expect(matches.some((m) => m.spotify === 'Music League - Alice')).toBe(true);
  });

  it('does not match wildcard submittedBy when submittedBy is absent', () => {
    const matches = applyRules(
      testConfig,
      { command: 'song', tags: [] },
      { weekNumber: 7, year: 2026 },
    );
    expect(matches.every((m) => m.name !== 'Per submitter')).toBe(true);
  });

  it('returns empty array when config has no rules', () => {
    const empty: RulesConfig = { defaults: {}, rules: [] };
    const matches = applyRules(empty, { command: 'song', tags: [] }, { weekNumber: 1, year: 2026 });
    expect(matches).toHaveLength(0);
  });

  it('does not match command rule when command differs', () => {
    const matches = applyRules(
      testConfig,
      { command: 'playlist', tags: [] },
      { weekNumber: 7, year: 2026 },
    );
    expect(matches.every((m) => m.name !== 'Weekly playlist')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify the new tests fail**

```
npm test -- tests/rules.test.ts
```
Expected: error `Cannot find module '../src/rules/engine.js'`

- [ ] **Step 3: Create `src/rules/engine.ts`**

```typescript
import type { RulesConfig, Rule } from '../config/types.js';
import type { TemplateContext, RuleMatch } from './types.js';
import { resolveTemplate } from './templates.js';

interface SubmissionContext {
  command: string;
  tags: string[];
  submittedBy?: string;
  groupId?: string;
}

function ruleMatches(rule: Rule, submission: SubmissionContext): boolean {
  const { when } = rule;

  if (when.command !== undefined && when.command !== submission.command) return false;

  if (when.tag !== undefined && !submission.tags.includes(when.tag)) return false;

  if (when.submittedBy !== undefined) {
    if (when.submittedBy === '*') {
      if (!submission.submittedBy) return false;
    } else if (when.submittedBy !== submission.submittedBy) {
      return false;
    }
  }

  if (when.groupId !== undefined && when.groupId !== submission.groupId) return false;

  return true;
}

export function applyRules(
  config: RulesConfig,
  submission: SubmissionContext,
  context: TemplateContext,
): RuleMatch[] {
  return config.rules
    .filter((rule) => rule.enabled && ruleMatches(rule, submission))
    .map((rule) => ({
      name: rule.name,
      spotify: rule.playlist.spotify
        ? resolveTemplate(rule.playlist.spotify, context)
        : undefined,
      youtube: rule.playlist.youtube
        ? resolveTemplate(rule.playlist.youtube, context)
        : undefined,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test -- tests/rules.test.ts
```
Expected: PASS (all 15 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rules/engine.ts tests/rules.test.ts
git commit -m "feat: add rules engine with template resolution"
```

---

### Task 6: Music adapter interfaces

**Files:**
- Create: `src/music/types.ts`

No tests — interfaces have no runtime behavior.

- [ ] **Step 1: Create `src/music/types.ts`**

```typescript
export interface ResolvedTrack {
  title: string;
  artist: string;
  album?: string;
  durationMs?: number;
  spotifyTrackId?: string;
  spotifyUri?: string;
  youtubeVideoId?: string;
  sourceUrl?: string;
  confidence: number;
}

export interface ISpotifyAdapter {
  searchTrack(query: string): Promise<ResolvedTrack | null>;
  getTrackById(spotifyTrackId: string): Promise<ResolvedTrack | null>;
  findOrCreatePlaylist(name: string): Promise<string>;
  addTrackToPlaylist(playlistId: string, spotifyUri: string): Promise<void>;
  isTrackInPlaylist(playlistId: string, spotifyUri: string): Promise<boolean>;
}

export interface IYouTubeAdapter {
  searchVideo(query: string): Promise<{ videoId: string; title: string } | null>;
  findOrCreatePlaylist(name: string): Promise<string>;
  addVideoToPlaylist(playlistId: string, videoId: string): Promise<void>;
  isVideoInPlaylist(playlistId: string, videoId: string): Promise<boolean>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/music/types.ts
git commit -m "feat: add Spotify and YouTube adapter interfaces"
```

---

### Task 7: Wire index.ts, copy rules.json, update README

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Replace `src/index.ts`**

```typescript
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config/loader.js';
import { parseMessage } from './parser/parseMessage.js';
import { applyRules } from './rules/engine.js';
import { getISOWeekNumber } from './rules/templates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, '../config/rules.json');

const config = loadConfig(configPath);
const weekNumber = getISOWeekNumber(new Date());
const year = new Date().getFullYear();

const examples = [
  '!song https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
  '!song Sade - No Ordinary Love',
  '!song The Beths - Expert in a Dying Field #summer',
  'hello world (ignored)',
];

for (const text of examples) {
  const parsed = parseMessage(text);
  if (!parsed) {
    console.log(`[ignored]  ${text}`);
    continue;
  }
  const matches = applyRules(config, parsed, { weekNumber, year });
  console.log(`[parsed]   ${parsed.rawText}`);
  console.log(`           command=${parsed.command} tags=[${parsed.tags.join(', ')}]`);
  for (const match of matches) {
    const spotify = match.spotify ?? '-';
    const youtube = match.youtube ?? '-';
    console.log(`           → "${match.name}": spotify="${spotify}" youtube="${youtube}"`);
  }
}
```

- [ ] **Step 2: Copy rules.json from the example**

```bash
cp config/rules.example.json config/rules.json
```

- [ ] **Step 3: Run `npm run dev` to verify no errors**

```
npm run dev
```
Expected: printed output for each example with matched rules, no thrown errors.

- [ ] **Step 4: Run the full test suite**

```
npm test
```
Expected: all tests pass across `config.test.ts`, `parser.test.ts`, `rules.test.ts`.

- [ ] **Step 5: Update README.md — add "Running tests" section after "Quick start"**

Insert after the closing ` ``` ` of the Quick start block:

```markdown
## Running tests

```bash
npm test
```

To run a specific test file:

```bash
npm test -- tests/parser.test.ts
npm test -- tests/rules.test.ts
npm test -- tests/config.test.ts
```

The test suite covers the message parser (all `!song` command variants) and the rules engine (command matching, tag matching, template resolution, wildcard submitter). No external API calls are made.
```

- [ ] **Step 6: Commit**

```bash
git add src/index.ts README.md
git commit -m "feat: wire index.ts demo and update README with test instructions"
```
