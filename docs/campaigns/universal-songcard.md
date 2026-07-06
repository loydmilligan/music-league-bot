# Campaign Plan: Universal Songcard

**Status:** DRAFT — awaiting approval before Phase 0 begins  
**Design handoff:** `docs/design_handoff_universal_songcard/design_handoff_universal_songcard/`  
**Primary reference:** `ml-songcard.jsx` (component + adapters), `README.md` (decisions + API)

---

## Background

Music League Bot renders "a song" in ~9 different places, each today a bespoke component with its own data shape, rating UI, and action set. This campaign collapses all of them into **one config-driven primitive ("unicard")**, adopts the revised 4-axis rating model (Discovery · Theme fit · Quality · Replayability), and updates the Settings → App setup Rating-weights panel.

The design handoff is high-fidelity (production intent, final tokens) and includes a working React reference — port target is identical behavior in Svelte.

---

## Existing component inventory

| ID | Surface | Bespoke component(s) | File(s) |
|----|---------|----------------------|---------|
| HS | History search | `SongSearchCard.svelte` (consumed by `SongSearchTab.svelte`) | `ui/src/lib/components/SongSearchCard.svelte`, `SongSearchTab.svelte` |
| SL | Shortlist | `ShortlistRow.svelte`, `MiniDna.svelte`, `ScoreChip.svelte` | `ui/src/lib/shortlist/` |
| RR | Round research | song rows inside `ResearchList.svelte` | `ui/src/lib/components/ResearchList.svelte` |
| H2H | Head-to-head | `HeadToHeadCard.svelte` | `ui/src/lib/components/HeadToHeadCard.svelte` |
| SLH | Shortlist king-of-hill | `ShortlistH2HPanel.svelte` | `ui/src/lib/shortlist/ShortlistH2HPanel.svelte` |
| CH | Chat songs | cards in `ui/src/routes/content/+page.svelte` | (inline, no extracted component) |
| DG | Digest | song display in digest export rendering | `ui/src/lib/digest/` (scattered) |
| BS | Public b-side | *(deferred — no song card exists here yet; no feature is removed by waiting)* | `bside/src/` |

**Supporting utilities replaced:**  
- `SongRatingBars.svelte` → superseded by `Rating.svelte` bars mode  
- `ui/src/lib/scoring.js` → `computeScore` updated for new 4-axis model  

---

## Current ratings schema (pre-migration)

| Table | Existing columns | Scale |
|-------|-----------------|-------|
| `shortlist_songs` | `rating_discovery`, `rating_theme_fit`, `rating_nostalgia`, `rating_personal` | 0–5 |
| `research_songs` | `discovery_potential`, `theme_fit`, `nostalgia_potential`, `personal_rating` | 1–5 |
| `settings` | `weight_discovery`, `weight_theme_fit`, `weight_nostalgia`, `weight_personal` | 0–100 |

**Current `Settings` interface** (types.ts): `weightDiscovery`, `weightThemeFit`, `weightPersonal`, `weightNostalgia`

---

## New rating model (target)

| Key | Label | Color token | hex |
|-----|-------|-------------|-----|
| `discovery` | Discovery | `--sky` | `#5aa3ff` |
| `themeFit` | Theme fit | `--mash-pulp` | `#ff5b2e` |
| `quality` | Quality | `--moss` | `#3ec27a` |
| `replayability` | Replayability | `--amber` | `#e8a83a` |

Scale: **0–5, `null` = unrated**. Nostalgia and Personal are retired; quality seeds from legacy personal via adapter; replayability starts null on all legacy rows.

---

## Phased milestones

### Phase 0: Foundation primitives *(no surface changes, no schema changes)*

**Goal:** the unicard primitive exists and is unit-tested, importable, but wired to nothing yet.

#### 0-A — Canonical Song type + adapters

**New files:**
- `ui/src/lib/song/canonical.ts` — `Song`, `SongRatings`, `N0_5` types; `makeSong()`, `DIMS`, `BUCKETS`, `EMPTY_RATINGS`, `fmtDur`
- `ui/src/lib/song/adapters.ts` — six adapter functions: `fromSpotify`, `fromShortlist`, `fromResearch`, `fromH2H`, `fromChat`, `fromPodium`
- `ui/src/lib/song/adapters.test.ts` — unit tests (see Section 5)

Lift directly from `ml-songcard.jsx`. The adapters are pure functions; they map field-name differences, art URL spellings (`coverUrl` / `albumArtUrl` / `album_art_url`), and rating scale differences (H2H 1–5 → 0–5 via `rescale1to5`). Adapters do NOT depend on the DB — they run in the browser.

Key adapter mappings:

| Source field | Canonical field | Note |
|---|---|---|
| `ratingPersonal` | `quality` | quality seeds from personal on legacy shortlist rows |
| `ratingQuality` | `quality` | takes precedence over personal if present |
| `ratingReplayability` | `replayability` | null on all legacy rows |
| `nostalgiaPotential` / `ratingNostalgia` | *(dropped)* | no canonical field |
| `coverUrl` / `albumArtUrl` / `album_art_url` / `imageUrl` | `art.url` | three-spelling fold |
| H2H `discoveryPotential` (1–5) | `discovery` | rescale1to5 applied |

**Exit criteria:** `npm run test` passes on all adapter tests; types compile.

---

#### 0-B — `Rating.svelte` — unified 6-mode rating

**New file:** `ui/src/lib/song/Rating.svelte`

Props: `value: SongRatings`, `mode: 'bars' | 'mini' | 'chip' | 'dots' | 'fingerprint' | 'strata'`, `editable?: boolean`, `size?: 'sm' | 'lg'`  
Event: `on:change` (fires `{key, value}` pairs)

Six mode implementations (port from `ml-songcard.jsx`):

| Mode | Description | Editable? | Used by |
|------|-------------|-----------|---------|
| `bars` | 4 click-to-set bar tracks 0–5 | yes | SL (expanded), RR |
| `dots` | 4×5 dot grid, click-to-set | yes | H2H, SLH |
| `mini` | 4 tiny bars, proportional height | no | SL (collapsed row) |
| `chip` | Aggregate /20 with opacity stacking | no | DG |
| `fingerprint` | 2×2 quadrant tile, tap-to-increment | yes | analyze panel |
| `strata` | Single proportional stacked bar | no | future |

Interaction contracts:
- `bars`: click at proportional position → `ceil((offsetX/width) * 5)` → clamp 0–5
- `dots`: click Nth dot → set to N; clicking current value → N-1 (toggles down)
- `fingerprint`: click quadrant → increment, wraps 5→0

All read-only modes (`mini`, `chip`, `strata`) have no interactivity and accept no event handlers.

**Exit criteria:** Rating.svelte renders all 6 modes in `_examples` page; editable modes fire events.

---

#### 0-C — `SongCard.svelte` + `SongList.svelte`

**New files:** `ui/src/lib/song/SongCard.svelte`, `ui/src/lib/song/SongList.svelte`

**SongCard props:**
```ts
song: Song
density: 'row' | 'expanded'           // default 'row'
config: SongCardConfig
defaultExpanded?: boolean
onAction?: (actionId: string, song: Song) => void
onRate?: (ratings: SongRatings, song: Song) => void
onAnalyze?: (song: Song) => void
```

**SongCardConfig:**
```ts
{
  ratingMode: RatingMode           // none|mini|chip|bars|dots|fingerprint|strata
  ratingEditable?: boolean
  art?: boolean; artPx?: number
  bucket?: boolean; duration?: boolean; showAlbum?: boolean
  accent?: 'accent' | 'moss' | 'sky' | 'amber' | 'ember'
  layers?: Array<'state'|'rating'|'meta'|'tags'|'badges'|'corpus'|'chat'|'notes'|'analyze'>
  actions?: string[]
  actionStyle?: 'inline' | 'reveal' | 'menu'
  expandedConfig?: Partial<SongCardConfig>   // overrides when row expands
  shortlisted?: boolean                       // drives active state on shortlist action
  noteText?: string                           // initial value for notes textarea
}
```

**SongCard internal state:** `expanded: boolean` (row density only), `ratings: SongRatings` (optimistic copy, resets on `song` change via reactive `$: ratings = song.ratings`).

**SongList props:** `songs: Song[]`, `density`, `config`, `accordion?: boolean` (default true for row), `emptyLabel?`, `onAction`, `onRate`, `onAnalyze`. Manages single-open accordion via `openId` local state.

**Layers** — each renders only when data is present (no empty shells):
- `state` → assignment chips, submittedElsewhere, saveForFuture pills, and **history status chip** (see below)
- `rating` → `<Rating>` component + label
- `meta` → `StatRow`: tastemaker score, tempo, energy, lyrics
- `tags` → genre/mood tag chips from `song.metadata.tags`
- `badges` → medals, discussed, poop badges (mono glyph, no emoji)
- `corpus` → full league history for this song: submission count, which players submitted it, and chat mention count. Data shape: `{ appearances: number; submitters: string[]; chatMentions: number }`. Only meaningful on the **HS surface**. Currently served by `CorpusHistoryPanel.svelte`, deleted once HS migrates. **Note:** the corpus layer is the expanded-detail view — the summary indicator in the collapsed row is handled separately via `historyStatus` (see below).
- `chat` → chat context (mentions, intent, pull quotes)
- `notes` → textarea, fires `onAction('notes', song)` on change
- `analyze` → `AnalysisPanel` (5-job pipeline state machine)

**History status chip (HS surface, collapsed row always visible)**

The current `SongSearchCard` uses background color + border style to signal four states. The unicard replaces this with a compact labeled chip rendered directly in the collapsed row — always visible without expanding.

`song.context.historyStatus` is extended from the handoff's two-value `'mine'|'others'|null` to a four-value enum:

```ts
historyStatus?: 'song-mine' | 'song-others' | 'artist-mine' | 'artist-others' | null;
```

| Value | Chip color | Chip label | Meaning |
|-------|-----------|------------|---------|
| `song-mine` | `--ember` | submitted · mine | This exact song was submitted before by the operator |
| `song-others` | `--ember` (dimmed) | submitted | This exact song was submitted before by someone else |
| `artist-mine` | `--amber` | artist · mine | A different song by this artist was submitted before by the operator |
| `artist-others` | `--amber` (dimmed) | artist seen | A different song by this artist was submitted before by someone else |
| `null` | — | (no chip) | No league history |

Song match takes precedence over artist match when both are true. The chip renders in the row header between the title/artist and the rating — always visible in the slim collapsed row, no expand required. The expanded `corpus` layer then shows the full detail (submitter names, round, count).

**Data source:** `SongSearchTab` already loads a `SongStatusMap` on mount via `GET /api/songs/history-status` (or equivalent). The `fromSpotify` adapter receives this map as context and uses it to set `historyStatus` on each canonical `Song`.

**Actions** — action IDs and their icons (Unicode glyphs per no-icon-font convention):

| ID | Glyph | Label | Style |
|----|-------|-------|-------|
| `shortlist` | `✚` | Shortlist | — |
| `research` | `✚` | Round research | — |
| `h2h` | `✚` | Add to H2H | — |
| `assign` | `▾` | Assign to round | — |
| `play` | `▸` | Play on Spotify | primary |
| `ytm` | `▸` | Play on YT Music | — |
| `analyze` | `↻` | Analyze / enrich | — |
| `notes` | `✎` | Notes | — |
| `save` | `☆` | Save for future | — |
| `submitted` | `⊘` | Mark submitted | — |
| `dismiss` | `✕` | Not interested | ember |
| `remove` | `✕` | Remove | ember |
| `winner` | `♔` | Pick winner | primary |

`inline` actionStyle: full-label buttons in a vertical rail  
`reveal` actionStyle: icon buttons hidden until row hover/focus  
`menu` actionStyle: overflow `⋯` button, destructive actions (ember) separated by divider

**Art fallback:** when `song.art` is null, render deterministic warm-gradient vinyl glyph (CSS/SVG) seeded from `song.id`.

**Analyze layer:** 5-job pipeline state machine (`idle → running → done`). On trigger fires `onAnalyze(song)` and wires to `POST /api/songs/[spotifyUri]/enrich`. On done, reveals fingerprint Rating (fingerprint mode, lg, read-only) + enriched StatRow.

**Motion:** row expand/collapse uses 120ms `--ease-out` fade (not slide). Buttons: `filter: brightness(0.92)` on hover, `translateY(1px)` on press. Never `scale()`.

**Exit criteria:** SongCard renders in both densities; all 8 layer combinations render correctly with demo data; actions fire events; rating modes work; accordion accordion closes old when new opens.

---

**Phase 0 exit criteria:** All three new components exist, compile with `npm run check`, have passing unit tests, and are wired to the `_examples` route for visual verification.

---

### Phase 1: Schema + API + Dual weights panel *(infra, no surface UI changes)*

**Goal:** DB supports new axes; API accepts them; settings UI shows both panels.

#### 1-A — DB migration: add new rating columns

**`shortlist_songs` additions:**
```sql
ALTER TABLE shortlist_songs ADD COLUMN rating_quality    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shortlist_songs ADD COLUMN rating_replayability INTEGER NOT NULL DEFAULT 0;
```

**`research_songs` additions:**
```sql
ALTER TABLE research_songs ADD COLUMN quality     INTEGER CHECK(quality BETWEEN 0 AND 5);
ALTER TABLE research_songs ADD COLUMN replayability INTEGER CHECK(replayability BETWEEN 0 AND 5);
```

Do **not** drop `rating_nostalgia`, `rating_personal`, `nostalgia_potential`, `personal_rating` yet — legacy components still read them until their surface migrates.

**Settings table additions:**
```sql
ALTER TABLE settings ADD COLUMN weight_quality        INTEGER NOT NULL DEFAULT 20;
ALTER TABLE settings ADD COLUMN weight_replayability  INTEGER NOT NULL DEFAULT 10;
ALTER TABLE settings ADD COLUMN legacy_weights_deprecated_at TEXT;
```

Add these via `runMigration` in `db/client.ts` (or the existing schema-sync pattern — check how migrations are applied in this codebase).

---

#### 1-B — Type + settings updates

- Update `Settings` type in `types.ts`: add `weightQuality`, `weightReplayability`; keep `weightNostalgia`, `weightPersonal` for legacy panel reads
- Update `getSettings(db)` and `updateWeights(db, w)` to include new columns
- Add `updateUnicardWeights(db, w)` and `updateLegacyWeightsDeprecatedAt(db, ts)` helpers
- Update `ShortlistSong` type: add `ratingQuality: number`, `ratingReplayability: number`
- Update `ResearchSong` type: add `quality: number | null`, `replayability: number | null`
- Update `H2HCandidate` type: add `quality: number | null`, `replayability: number | null`

---

#### 1-C — `computeScore` update

Update `ui/src/lib/scoring.js` to compute weighted score over the 4 new axes:

```js
// New formula: Σ(rating * weight) / Σ(weight) * 4  → /20
export function computeScore(song, weights) {
  const dims = ['discovery', 'themeFit', 'quality', 'replayability'];
  // ... normalize song field names to canonical via adapter if needed
}
```

Keep a `computeLegacyScore(song, weights)` for pre-migration surfaces until they're replaced.

---

#### 1-D — API endpoint updates

For each rating PATCH endpoint (shortlist, research songs, H2H candidates), accept new fields without breaking existing callers:

- `PATCH /api/shortlist/[id]` — accept `ratingQuality`, `ratingReplayability` in body (nullable)
- `PATCH /api/research/[roundId]/songs/[id]` — accept `quality`, `replayability`
- `PATCH /api/h2h/[sessionId]/songs/[id]` — accept `quality`, `replayability`

Verify no API shape changes are breaking for existing consumers (old fields still accepted).

---

#### 1-E — Dual weights panel in Settings → App setup

Update `ui/src/routes/settings/+page.svelte` to render two panels (port `weights.jsx`):

1. **"Universal songcard"** panel — editable, 4 new axes (Discovery/ThemeFit/Quality/Replayability), default weights `30/40/20/10`. Shows live weighted score preview (fingerprint mode).
2. **"Legacy cards"** panel — frozen/read-only (dashed border, deprecated badge, dimmed sliders), 4 old axes. Has explanatory copy: "Remove after migration. Applies only to pre-unicard surfaces." Hidden automatically once `legacy_weights_deprecated_at` is set.

Storage: single settings row holds both weight sets. Unicard weights use new columns; legacy weights use existing columns (read-only, no writes).

**Persistence:** `updateUnicardWeights(db, w)` → PATCH action in page.server.ts.

**Exit criteria:** Settings page renders both panels; unicard weights save/load; legacy panel is frozen; weighted score preview updates live.

---

**Phase 1 exit criteria:** `npm run check` passes; DB migration runs clean on both fresh and existing DBs; all type errors resolved; Settings dual panel visible and working.

---

### Phase 2: Surface migrations

Migrate surfaces highest-traffic first. Each migration is independently deployable. **Convention:** replace the bespoke component, delete it, update the consuming page to use `<SongCard>`/`<SongList>` with the correct config, and update any PATCH calls to use the new `onRate` callback.

---

#### 2-A — Shortlist (SL) — replaces `ShortlistRow`, `MiniDna`, `ScoreChip`

**Route:** `ui/src/routes/shortlist/+page.svelte`  
**Deleted:** `ShortlistRow.svelte`, `MiniDna.svelte`, `ScoreChip.svelte`

**Adapter:** `adapters.fromShortlist(song: ShortlistSong) → Song`

Shortlist currently reads `ratingDiscovery/ThemeFit/Nostalgia/Personal`. The adapter maps `ratingPersonal → quality` and sets `replayability` from `ratingReplayability` (null on legacy rows until re-rated).

**Config (collapsed row):**
```js
{
  density: 'row',
  ratingMode: 'mini',
  art: true, bucket: true,
  actionStyle: 'reveal',
  actions: ['play', 'assign'],
  expandedConfig: {
    ratingMode: 'bars', ratingEditable: true,
    layers: ['state', 'rating', 'meta', 'tags', 'notes'],
    actions: ['play', 'assign', 'analyze', 'save', 'submitted', 'remove'],
    actionStyle: 'inline', accent: 'accent', artPx: 120,
  }
}
```

**Action wiring:**

| Action ID | Endpoint / behavior |
|-----------|---------------------|
| `play` | Open Spotify URI |
| `assign` | POST `/api/shortlist/[id]/assign` |
| `analyze` | POST `/api/songs/[spotifyUri]/enrich` (via `onAnalyze`) |
| `save` | PATCH `/api/shortlist/[id]` `{ saveForFuture: true }` |
| `submitted` | PATCH `/api/shortlist/[id]` `{ submittedElsewhere: true }` |
| `remove` | DELETE `/api/shortlist/[id]` |

**Rating persistence:** `onRate` → `PATCH /api/shortlist/[id]` with `{ ratingDiscovery, ratingThemeFit, ratingQuality, ratingReplayability }` (map from canonical keys in callback).

**Edge cases:**
- Assignment chips (round IDs) must appear in `song.context.assignments` — ensure shortlist API returns this
- `submittedElsewhere` + `submittedByOther` must be present in context for `state` layer
- Sort-by-score must use `computeScore` with new weights after migration

**Deleted components:** `ShortlistRow.svelte`, `MiniDna.svelte`, `ScoreChip.svelte`

---

#### 2-B — Round research (RR) — replaces song rows in `ResearchList`

**Route:** `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` (research tab)  
**Deleted:** research song row rendering inside `ResearchList.svelte` (the ResearchList wrapper itself may stay as a container, or be absorbed into the page)

**Adapter:** `adapters.fromResearch(song: ResearchSong) → Song`

Research songs use a 1–5 scale on disk — adapter converts via `clamp05` (no rescaling needed since they're already approximately 0–5 semantically; only H2H needs explicit rescale).

**Config:**
```js
{
  density: 'expanded',
  art: false, ratingMode: 'bars', ratingEditable: true,
  actionStyle: 'inline',
  layers: ['state', 'rating', 'meta', 'tags', 'notes'],
  actions: ['play', 'ytm', 'analyze', 'save', 'remove'],
}
```

**Action wiring:**

| Action ID | Endpoint |
|-----------|----------|
| `play` | Open Spotify URI |
| `ytm` | Open `song.ytmUrl` (from `ytm_link` on research row) |
| `analyze` | POST `/api/songs/[spotifyUri]/enrich` |
| `save` | PATCH `/api/research/[roundId]/songs/[id]` `{ saveForFuture: true }` |
| `remove` | DELETE `/api/research/[roundId]/songs/[id]` |

**Rating persistence:** `onRate` → `PATCH /api/research/[roundId]/songs/[id]` with new fields.

**Edge cases:**
- Sort-by-weighted-score: update to use `computeScore` with new axes
- Auto-sort-on-all-4-complete: update trigger to fire when all 4 new axes are non-null
- `submittedByOther` flag from `otherSubmissionVotes` must populate `song.context`

---

#### 2-C — Head-to-head (H2H) — replaces `HeadToHeadCard`

**Route:** `ui/src/routes/league/[league]/season/[n]/round/[roundId]/+page.svelte` (H2H tab)  
**Deleted:** `HeadToHeadCard.svelte`

**Adapter:** `adapters.fromH2H(song: H2HCandidate) → Song` — applies `rescale1to5` (1–5 → 0–5).

**Config (both cards in the pairwise grid):**
```js
{
  density: 'expanded',
  art: false, ratingMode: 'dots', ratingEditable: true,
  actionStyle: 'inline',
  layers: ['rating'],
  actions: ['play', 'winner'],
}
```

Both cards sit in a `display: grid; grid-template-columns: 1fr 1fr` layout (no SongList, just two SongCards side-by-side).

**Action wiring:**

| Action ID | Behavior |
|-----------|----------|
| `play` | Open Spotify URI in iframe (lazy) |
| `winner` | POST to H2H session advance endpoint |

**Rating persistence:** `onRate` → PATCH H2H song endpoint; weighted score recomputed in parent via `computeScore`.

**Edge cases:**
- H2H stores ratings on 1–5 scale. After migration, store on 0–5. Adapter handles display rescaling; PATCH must save the raw 0–5 value.
- "Holding lane" vs "challenger" visual distinction: use `accent` config prop (`accent: 'sky'` for challenger, `accent: 'accent'` for holder) to drive the left-rail color.

---

#### 2-D — Shortlist king-of-hill (SLH) — replaces `ShortlistH2HPanel`

**Route:** embedded in `ui/src/routes/shortlist/+page.svelte`  
**Deleted:** `ShortlistH2HPanel.svelte`

**Config:** same as H2H (dots mode, no art, rating + winner), but operating on `ShortlistSong` items via `fromShortlist` adapter.

**Edge case:** SLH compares shortlist songs (not research songs) — ensure adapter choice is `fromShortlist`, not `fromH2H`. The 0–5 scale is native to shortlist so no rescaling needed.

---

#### 2-E — History search (HS) — replaces `SongSearchCard`

**Route:** `ui/src/routes/history/+page.svelte` via `SongSearchTab.svelte`

**Consumer chain:** `history/+page.svelte` → `SongSearchTab.svelte` → `SongSearchCard.svelte` + `CorpusHistoryPanel.svelte`

**Migration:** Update `SongSearchTab.svelte` to import and use `<SongCard>` instead of `SongSearchCard`. The tab currently loads a `SongStatusMap` on mount and passes it as a prop to `SongSearchCard` to drive background color and border styles. This status map is now used inside the `fromSpotify` adapter call to populate `song.context.historyStatus` (four-value enum) and `song.context.corpus` on each canonical `Song`. The `SongCard` then renders the history status chip in the collapsed row automatically. Once `SongSearchTab` no longer imports `SongSearchCard`, delete both `SongSearchCard.svelte` and `CorpusHistoryPanel.svelte`.

**Deleted:** `SongSearchCard.svelte`, `CorpusHistoryPanel.svelte`  
**Updated:** `SongSearchTab.svelte` (swaps import; feeds status map into adapter)

**Adapter:** `adapters.fromSpotify(result: SpotifyResult, statusMap?: SongStatusMap) → Song` — extends the base adapter signature with an optional status map argument so the tab can pass in the preloaded history data.

**Config:**
```js
{
  density: 'row',
  ratingMode: 'none', art: true, duration: true,
  actionStyle: 'menu',
  actions: ['shortlist', 'research', 'h2h', 'play'],
  expandedConfig: {
    layers: ['state', 'badges', 'corpus', 'meta', 'tags'],
    actions: ['shortlist', 'research', 'h2h', 'play'],
    actionStyle: 'inline', accent: 'accent', artPx: 120,
  }
}
```

Note `state` is included in the expanded layers so the history status chip also appears there with its full label alongside other state pills.

**Action wiring:**

| Action ID | Behavior |
|-----------|----------|
| `shortlist` | POST `/api/shortlist` to add song |
| `research` | POST `/api/research/[roundId]/songs` |
| `h2h` | POST to H2H session songs endpoint |
| `play` | Open Spotify URI |

**History status chip (collapsed row):** always visible in the slim row when `historyStatus` is non-null. See full spec in the SongCard section above. The four states replace the current red/orange background + solid/dashed border treatment from `SongSearchCard`.

**Edge cases:**
- `SongSearchCard` currently receives snippets (`{songBadges}`, `{artistBadges}`, etc.) — song-level badges move into `song.context.badges`; artist badges move into a new `song.context.artistBadges` field or are collapsed into the history status chip (TBD during Phase 2-E implementation).
- Song match takes precedence over artist match when both are true — adapter sets `historyStatus` to `song-*` in that case.

---

#### 2-F — Chat songs (CH)

**Route:** `ui/src/routes/content/+page.svelte`  
**Currently:** inline bespoke rendering, no extracted component

**Adapter:** `adapters.fromChat(mention: ChatMentionSong) → Song`

**Config:**
```js
{
  density: 'row',
  ratingMode: 'none', art: true,
  actionStyle: 'inline', accent: 'sky', artPx: 120,
  layers: ['chat'],
  actions: ['shortlist', 'assign', 'play', 'dismiss'],
}
```

**Action wiring:**

| Action ID | Behavior |
|-----------|----------|
| `shortlist` | POST `/api/shortlist` |
| `assign` | POST `/api/shortlist/[id]/assign` |
| `play` | Open Spotify URI |
| `dismiss` | PATCH mention → dismissed |

**Chat layer data:** `chat.mentionCount`, `chat.chats` (name + tone chips), `chat.intent` (ALT/RETRO/FOUND), `chat.mentions` (pull quotes with sender, avatar, priors). These must be populated from the chat content API response into `song.context.chat`.

---

#### 2-G — Digest (DG) *(read-only)*

**Route:** digest export rendering in `ui/src/lib/digest/`  
**Constraint:** read-only; no rating editor, no actions; no operator fields exposed

**Adapter:** `adapters.fromPodium(podiumEntry) → Song` — populates `context.rank`, `context.points`, `context.submitter`

**Config:**
```js
{
  density: 'expanded',
  art: true, artPx: 88,
  ratingMode: 'chip', ratingEditable: false,
  actionStyle: 'menu', actions: [],
  layers: ['badges', 'meta', 'tags'],
}
```

**Edge cases:**
- Digest rendering happens server-side via Puppeteer for PNG export — must work without browser JS (SSR-safe Svelte component, no browser-only APIs)
- The `chip` rating mode shows aggregate /20 — operator facing only; not shown on b-side
- No `analyze` layer in digest (no enrichment from a frozen report)

---

### Phase 3: B-side public skin (BS) *(deferred)*

**Deferred until after all operator surfaces are migrated.** The b-side currently has no song card — `ArchiveScreen` shows plain text winner entries in a round archive list and `HomeScreen` shows an inline winner string. No existing feature is removed by deferring this. When the time comes, this phase adds a new b-side podium-results view; it is greenfield work, not a migration.

**Repo:** `bside/src/`  
**Constraint:** separate lighter fan-facing skin — warm light palette, points-forward, no operator layers

**Two options:**
1. **Shared `SongCard` with a CSS theme override** (b-side applies `data-theme="bside"` and overrides tokens in its own CSS)
2. **Separate lightweight `BSideSongRow.svelte`** — simpler, avoids bundling operator-only layers into the public build

**Recommended:** Option 2. The b-side is a separate Vite app; pulling in the full `ui/src/lib/song/` package adds adapter/layer code that's never used. A thin `BSideSongRow.svelte` that takes a `canonical Song` and renders rank/art/title/artist/submitter/points is the right scope.

**BSide song row layout (from `surfaces.jsx` BSidePublic):**
- Rank number (left)
- Art fallback gradient (fixed square, no img)
- Title + artist
- First tag chip
- Submitter avatar + name
- Points (large number)
- Play button (→ Spotify URI)

**Read-only contract:** no rating UI, no actions that mutate state. Play button is the only action (external link).

**Adapter:** `adapters.fromPodium` (already defined in Phase 0) — or a simpler inline adapter in the bside package since it doesn't need the full library.

---

**Per-surface exit criteria (technical):** bespoke component file deleted; `npm run check` passes; `npm run test` passes; PATCH endpoints verified in network tab.

**Per-surface UAT gate (visual acceptance — human required):** After each surface migration, implementation PAUSES and presents a UAT checklist to the operator for sign-off before the bespoke component is deleted and before the next surface begins. The UAT pass must be done with the dev server running (`cd ui && npm run dev -- --host --port 51XX`) and covers:

| UAT item | What to check |
|----------|---------------|
| Collapsed row renders | Song displays correctly at rest — art, title, artist, any status chips |
| Expanded card renders | All expected layers appear; no empty shells; metadata visible if present |
| Rating interaction | Click/tap works; value persists after blur; correct mode for the surface |
| Actions fire | Each button triggers expected behavior (assign, play, etc.); no JS errors in console |
| History status chip (HS only) | Correct color + label for all 4 states visible in slim row |
| Accordion behavior (list surfaces) | Opening one row closes the previous; Esc collapses |
| Read-only enforcement (DG) | No rating editor rendered; no action buttons in DOM |
| No regressions | Spot-check adjacent surfaces not yet migrated still work normally |

**Gate protocol:** implementer commits the migration and signals DONE. Operator runs the dev server, performs the UAT checklist, and replies with either **UAT PASS** (proceed to delete bespoke component + start next surface) or **UAT FAIL + notes** (implementer fixes before component is deleted). The bespoke component is NOT deleted until UAT passes.

---

## 3 — Additional accommodating changes

### 3-A — Schema: new columns

See Phase 1-A. Summary:
- `shortlist_songs`: add `rating_quality INT DEFAULT 0`, `rating_replayability INT DEFAULT 0`
- `research_songs`: add `quality INT`, `replayability INT`
- `settings`: add `weight_quality INT DEFAULT 20`, `weight_replayability INT DEFAULT 10`, `legacy_weights_deprecated_at TEXT`

**No DROP columns during the campaign.** Nostalgia and personal columns stay until Phase 4 cleanup (after all surfaces migrated).

### 3-B — API response shapes

Every song-serving endpoint must return the new fields alongside the old so adapters can populate them:

- `/api/shortlist` + `PATCH`: include `ratingQuality`, `ratingReplayability`
- `/api/research/[roundId]/songs` + `PATCH`: include `quality`, `replayability`  
- `/api/h2h/*`: include new rating fields
- Search endpoint (`/api/songs/search`): no rating fields (Spotify results start unrated)

No breaking changes — old clients still get old fields; new unicard consumers get new fields via adapter.

### 3-C — Enrich/analyze flow

The analyze layer in `SongCard` triggers `POST /api/songs/[spotifyUri]/enrich` — this endpoint already exists (from the unified metadata queue campaign). No changes needed to the endpoint itself. The `metadata.enrichState` field on the canonical `Song` must be populated from the `song_metadata_queue` status when building API responses.

### 3-D — Score / weightedScore computation

`computeScore(song, weights)` must be updated for the new 4 axes. Affect points:
- Weighted score chips (`chip` mode) in Digest will change value if operator has re-rated songs under new axes
- H2H sorting by `weightedScore` must use unicard weights once surface is migrated
- Shortlist sort-by-score must use unicard weights

Keep `computeLegacyScore` until all surfaces are migrated. Delete it in Phase 4.

### 3-E — B-side read-only contract

The b-side `read_model.json` (built from the operator DB on digest export) must include `song.metadata.tags` and the new rating fields (or omit ratings entirely — b-side shows points, not operator ratings). The existing `AlbumPodium` serialization in the operator must be updated to include `spotifyUri`, `art.url`, `metadata.tags` per the new canonical shape.

---

## 4 — Ratings deprecation plan

### Rating model migration sequencing

```
Phase 0  → Canonical types + adapters exist (no DB change)
Phase 1  → New DB columns added; API accepts new fields; dual weights panel live
Phase 2A → SL migrated → quality/replayability now set on shortlist from unicard
Phase 2B → RR migrated → quality/replayability now set on research songs
Phase 2C → H2H migrated → all major raters use new model
...
Phase 2G → DG migrated → last pre-migration consumer retired
Phase 4  → DROP nostalgia/personal columns; delete legacy weights panel
```

### Legacy data behavior per surface

On each surface as it migrates:
- `quality` is seeded from `legacy_personal` via adapter (opportunistic — not always blank on day 1)
- `replayability` is always `null` on legacy rows — renders as `—` in all rating modes
- `nostalgia` is dropped — no canonical representation
- No backfill job — blank axes are honest; operators re-rate as they use the surfaces

### Dual weights panel

**Active panel ("Universal songcard"):** editable, drives all migrated surfaces. Default weights: `Discovery 30 · Theme fit 40 · Quality 20 · Replayability 10`.

**Deprecated panel ("Legacy cards"):** frozen/read-only (dashed border, `deprecated` chip, dimmed sliders). Keeps pre-migration cards scoring consistently. Shows copy: "Delete this panel once every surface is on the universal songcard." Hidden automatically when `legacy_weights_deprecated_at` is non-null.

**Storage:** `settings` table holds both sets. Unicard: `weight_quality`, `weight_replayability` (new cols) + existing `weight_discovery`, `weight_theme_fit`. Legacy: existing `weight_nostalgia`, `weight_personal` + existing discovery/themeFit (frozen, not updated after Phase 1).

**Deletion trigger:** once Phase 2-G (Digest) lands and all surfaces are on the unicard, set `legacy_weights_deprecated_at = NOW()`, hide the legacy panel in the Settings UI. The columns stay in the DB until Phase 4 cleanup.

### "Done" criteria for removing legacy code/columns/panel

All of the following must be true:
- [ ] All 7 operator surfaces (HS, SL, RR, H2H, SLH, CH, DG) use `<SongCard>` from `lib/song/`
- [ ] All bespoke song components are deleted (SongSearchCard, ShortlistRow, MiniDna, ScoreChip, HeadToHeadCard, ResearchList song rows, ShortlistH2HPanel)
- [ ] `legacy_weights_deprecated_at` is set (legacy panel hidden)
- [ ] No references to `ratingNostalgia`, `weightNostalgia`, `nostalgiaPotential` remain in TypeScript/Svelte (CI grep check)

Phase 4 then: `DROP COLUMN rating_nostalgia`, etc.; delete `computeLegacyScore`; remove legacy panel code.

---

## 5 — Testing plan

### Unit tests — adapters (Phase 0, `adapters.test.ts`)

| Test | What to verify |
|------|----------------|
| `fromSpotify` | id derived from uri; art.url from imageUrl; ratings all null |
| `fromShortlist` (modern row) | all 4 canonical fields populated; art three-spelling fold |
| `fromShortlist` (legacy row, no quality col) | quality seeds from ratingPersonal; replayability is null |
| `fromResearch` | quality from personalRating when quality col absent; scale 1-5 preserved |
| `fromH2H` | rescale1to5 applied: 1→0, 3→2.5≈3, 5→5 |
| `fromChat` | chat context populated; ratings all null |
| `fromPodium` | rank/points/submitter in context |
| `makeSong` | partial → canonical defaults filled |
| art fold | coverUrl / albumArtUrl / album_art_url / imageUrl all → art.url |

### Unit tests — score math (`scoring.test.ts`)

- `computeScore` with all 4 axes rated → correct weighted aggregate /20
- `computeScore` with some axes null → null axes contribute 0
- Legacy formula preserved in `computeLegacyScore` for regression

### Component tests — Rating.svelte

- All 6 modes render without error given a partial `SongRatings` (some null)
- `bars` mode: click at 60% position → sets value to 3
- `dots` mode: click current-value dot → decrements; click higher dot → sets
- `fingerprint` mode: click → increment, wraps 5→0
- Read-only modes (`mini`, `chip`, `strata`): no events fire on click
- `change` event fires with correct `{key, value}` structure

### Component tests — SongCard.svelte

- `density='row'`: renders row; click expands; click again collapses
- `density='expanded'`: renders expanded immediately, no toggle
- Layers: each layer renders only when its data is present; empty data → layer absent
- `actionStyle='reveal'`: action group hidden; appears on hover/focus
- `actionStyle='menu'`: overflow button renders; destructive actions separated by divider
- `onAction` callback fired with correct `(actionId, song)`
- `onRate` callback fired with new canonical `SongRatings` object on rating change
- Art fallback: when `song.art` is null, gradient vinyl glyph renders
- Accordion (SongList): opening one row closes the previously-open row

### Integration / e2e — action wiring (per surface, after each Phase 2 migration)

| Surface | Scenario | Check |
|---------|----------|-------|
| SL | Rate a song → change bars → onRate fires | PATCH shortlist/[id] called with new ratings |
| SL | Click "Remove" | DELETE shortlist/[id] called; song removed from list |
| SL | Click "Assign to round" | Assign popover opens; POST assign endpoint called |
| RR | Rate a research song | PATCH research/[roundId]/songs/[id] called |
| H2H | Click "Pick winner" | H2H session advances; loser removed |
| CH | Click "Dismiss" | Song removed from chat songs list |
| HS | Click "Shortlist" | Song added to shortlist; button shows active state |
| DG | Verify no actions rendered | No buttons in DOM |

### Regression checklist — score continuity during dual-weights window

- Pre-migration SL songs: `computeLegacyScore` produces same value as before migration (no drift)
- Post-migration SL songs: `computeScore` with new weights; verify a sample song scores ≤ 20
- After Phase 1-E settings change: legacy panel weights still frozen (no save button active)

---

## 6 — Deployment strategy

### Principles

- **Surface-by-surface:** each migration is one PR, independently deployable
- **No big bang:** the dual-weights panel and schema additions land first (Phase 1), then surfaces one at a time
- **Rollback:** each PR deletes one bespoke component; if rollback needed, restore from git. No data migration jobs means DB rollback is not required.
- **Coexistence:** legacy and unicard components coexist in the codebase until Phase 4. They read different DB columns and use different score formulas — no shared mutable state.

### Release order

| PR | Phase | Changes | Blast radius |
|----|-------|---------|-------------|
| PR-1 | 0 | Add `lib/song/` (canonical.ts, adapters.ts, Rating.svelte, SongCard.svelte, SongList.svelte). No routes changed. | Zero (new files only) |
| PR-2 | 1 | DB migration + type updates + API field additions + dual weights panel | Settings page only |
| PR-3 | 2-A | Migrate Shortlist (SL) | Shortlist route |
| PR-4 | 2-B | Migrate Round research (RR) | Round research tab |
| PR-5 | 2-C + 2-D | Migrate H2H + SLH | H2H tab + shortlist H2H panel |
| PR-6 | 2-E | Migrate History search (HS) | Song search results |
| PR-7 | 2-F | Migrate Chat songs (CH) | Content route |
| PR-8 | 2-G | Migrate Digest (DG) | Digest export |
| PR-9 | 4 | Cleanup: delete bespoke components, drop legacy columns, remove legacy panel | DB migration + file deletions |
| PR-10 | 3 (deferred) | B-side song card skin — new feature, no existing migration | bside/ only |

### Feature flag

No dedicated feature-flag infrastructure in this repo. Coexistence is the flag: legacy components stay until deleted in PR-N. If a migration goes wrong, `git revert PR-N` restores the bespoke component; the DB new columns are additive (no data loss on rollback).

### Post-deploy assertion (per the CLAUDE.md deploy rule)

After each `docker compose build bot-ui && docker compose up -d --force-recreate bot-ui`:
- Smoke the affected surface (e.g. for SL: open shortlist, confirm songs render, confirm rating bars work, confirm PATCH fires)
- Check network tab for no 4xx/5xx on rating PATCHes

---

## 7 — Documentation + repo work

### Component usage doc

After Phase 0 completes, add `ui/src/lib/song/README.md` documenting:
- The canonical `Song` type and which adapter to use for each source
- `SongCard` prop reference (config shape, layer list, action IDs)
- `Rating` mode reference with screenshots
- Porting checklist for new surfaces

### CONTRIBUTING update

Add a "Song display" section: "All song rendering goes through `<SongCard>` in `lib/song/`. To add a new song-surfacing screen, write an adapter in `lib/song/adapters.ts` and wire `<SongCard>` with the appropriate config. Do not write bespoke song components."

### Lint / type config

After Phase 4 cleanup:
- Add a CI grep check: `grep -rn "rating_nostalgia\|weightNostalgia\|nostalgiaPotential" ui/src/` should return zero results
- Confirm no dead imports remain (`npm run check` with `noUnusedLocals: true` in tsconfig)

### Changelog entries

Each PR should include a CHANGELOG entry under `## [Unreleased]`:
- Phase 0: "feat(song): universal songcard primitive + adapters + unified Rating component"
- Phase 1: "feat(settings): dual rating-weights panel; new DB columns for quality/replayability"
- Per surface: "feat(shortlist): migrate to universal songcard" etc.
- Phase 4: "chore: remove legacy nostalgia/personal rating columns and legacy weights panel"

---

## Appendix: Surface configs at a glance

| Surface | density | ratingMode | ratingEditable | layers | actions | actionStyle |
|---------|---------|------------|----------------|--------|---------|-------------|
| HS | row | none | — | badges, corpus, meta, tags | shortlist, research, h2h, play | inline (expanded) / menu (collapsed) |
| SL | row | mini (collapsed) / bars (expanded) | true | state, rating, meta, tags, notes | play, assign, analyze, save, submitted, remove | reveal (collapsed) / inline (expanded) |
| RR | expanded | bars | true | state, rating, meta, tags, notes | play, ytm, analyze, save, remove | inline |
| H2H | expanded | dots | true | rating | play, winner | inline |
| SLH | expanded | dots | true | rating | play, winner | inline |
| CH | row | none | — | chat | shortlist, assign, play, dismiss | inline |
| DG | expanded | chip | false | badges, meta, tags | — | — |
| BS | (custom) | — | — | rank, art, title, artist, submitter, points | play (link) | — |

---

## Open questions (resolve before Phase 0)

1. **SLH adapter:** ShortlistH2HPanel compares shortlist songs, not research songs. Should it use `fromShortlist` (0–5 native) or `fromH2H` (1–5 rescale)? **Assumed:** `fromShortlist` — shortlist songs are already 0–5, no rescaling needed.

2. **B-side Song type coupling:** Should the b-side import `lib/song/canonical.ts` from the operator (`ui/`) package, or duplicate the minimal type locally? The bside is a separate Vite app with its own `package.json`. **Assumed:** copy the minimal type into `bside/src/lib/types.ts` to avoid cross-package coupling.

3. **Digest SSR:** The digest export renders via Puppeteer (server-side screenshot). Confirm `SongCard` is SSR-safe (no `window`/`document` access in script init). **Risk:** `AnalysisPanel` uses `useState` pattern for pipeline; in digest context the analyze layer is disabled, so this should be fine — but verify.

4. **ResearchList wrapper:** `ResearchList.svelte` handles sorting, search, and auto-sort-on-all-4-complete. After RR migration, should this wrapper component be kept (as a list container) or absorbed into the round page? **Assumed:** keep as a thin container; replace only the inner song-row rendering.

---

*Plan complete. Awaiting approval before Phase 0 begins.*
