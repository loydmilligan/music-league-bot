# Digest section pipeline — research for "The Guesser" + "Storylines"

Read-only research. No code was modified. All paths are absolute under
`/home/loydmilligan/Projects/music-league-bot` unless noted.

Two new sections are planned:

- **A. "The Guesser"** — fully deterministic, computed records/leaderboards
  over vote data (no LLM prose). Model: the `stats` "By the numbers" section /
  `getRoundInsights` pattern.
- **B. "Storylines"** — deterministic evidence-gathering (chat window + vote
  comments) feeding a thin LLM write-up. Model: the existing 6
  `SECTION_KINDS` LLM sections (closest to `flow`/`quotes`), but sourced from
  curated evidence rather than the full round dump.

Both must default OFF per-league, following the `chat` section's opt-in
pattern (`chatSectionEnabledFor` / `CHAT_SECTION_DEFAULTS`).

---

## 1. Section kinds & schema

### 1.1 `SECTION_KINDS` (the LLM section kind enum)

`ui/src/lib/digest/llm.ts:10-11`

```ts
export const SECTION_KINDS = ['podium', 'villain', 'flow', 'consensus', 'quotes', 'chat'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];
```

This is the **single source of truth** for which kinds the LLM prompt system
knows about. It drives:

- `SECTION_DESCRIPTIONS` (`llm.ts:476-483`) — one-line prompt instruction per
  kind, used in the main draft prompt.
- `SECTION_DESCRIPTIONS_RECAP` (`llm.ts:488-495`) — season-recap variant of
  the same descriptions.
- `SECTION_SCHEMA` (`llm.ts:610-617`) — the JSON schema snippet for each kind,
  spliced into `buildSystemPrompt()` (`llm.ts:626-655`).
- `activeKindsForDraft()` (`llm.ts:659-669`) and `activeKindsForRecap()`
  (`llm.ts:598-606`) — both `.filter()` over `SECTION_KINDS`.
- `parseGenParams()` in the API route validates incoming section ids against
  `new Set<string>(SECTION_KINDS)` (`ui/src/routes/api/digest/[roundId]/draft/+server.ts:154`).
- `kindOrFallback()` in the page (`+page.svelte:1201-1203`) falls back to
  `'flow'` for any kind string not in `SECTION_KINDS` — i.e. **an LLM section
  kind not in this array is invisible to the type system and silently
  mis-rendered as flow**, though `digest_sections.kind` itself doesn't have
  this restriction (see below — the CHECK constraint is separate and stricter).

**Important design implication**: `SECTION_KINDS` is scoped to *LLM-generated,
`digest_sections`-table-backed* sections only. The existing deterministic
sections (`stats`, `standings`, `discoverability`, `nextRound`, `chat`'s
sub-block) are NOT in `SECTION_KINDS` — they are "synthetic" sections handled
entirely outside this array (see §3-4). **The Guesser should follow the
synthetic/`stats` pattern, NOT be added to `SECTION_KINDS`.** Storylines, being
LLM-authored, likely SHOULD be added to `SECTION_KINDS` if it's to reuse the
generation pipeline (draft/regen modal, pipeline model routing, cost ledger) —
see §2 and §7 for the tradeoff.

### 1.2 `digest_sections.kind` CHECK constraint

`ui/src/lib/db/schema.ts:193-206`:

```sql
CREATE TABLE IF NOT EXISTS digest_sections (
  id           TEXT PRIMARY KEY,
  draft_id     TEXT NOT NULL REFERENCES digest_drafts(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK(kind IN ('podium','villain','flow','consensus','quotes','chat')),
  position     INTEGER NOT NULL,
  state        TEXT NOT NULL DEFAULT 'default' CHECK(state IN ('default','excluded','locked')),
  content_json TEXT NOT NULL,
  edited_at    TEXT,
  regen_count  INTEGER NOT NULL DEFAULT 0,
  variant      TEXT NOT NULL DEFAULT 'textual' CHECK(variant IN ('textual','visual','both'))
);
```

This CHECK is a hard mirror of `SECTION_KINDS`. **If Storylines is stored as a
row in `digest_sections` (kind = `'storylines'`), this CHECK must be widened**
— SQLite has no `ALTER ... DROP/ADD CONSTRAINT`, so it needs the table-rebuild
migration pattern already used for `player_identities.identity_type`
(`ui/src/lib/db/client.ts:593-613`):

```ts
// Widen player_identities.identity_type to allow 'discord'. SQLite cannot ALTER
// a CHECK, so rebuild once when the current CHECK is the pre-discord one.
const piSql = (db.prepare(
  "SELECT sql FROM sqlite_master WHERE type='table' AND name='player_identities'",
).get() as { sql?: string } | undefined)?.sql;
if (piSql && !piSql.includes("'discord'")) {
  db.exec(`
    CREATE TABLE player_identities_new (
      ...
      identity_type TEXT NOT NULL CHECK(identity_type IN ('whatsapp','google-chat','music-league','discord')),
      ...
    );
    INSERT INTO player_identities_new (id, player_id, league_id, identity_type, identifier, created_at)
      SELECT id, player_id, league_id, identity_type, identifier, created_at FROM player_identities;
    DROP TABLE player_identities;
    ALTER TABLE player_identities_new RENAME TO player_identities;
  `);
}
```

The same pattern (detect old CHECK via `sqlite_master.sql`, `CREATE ...__new`,
`INSERT ... SELECT`, `DROP`, `RENAME`) is copy-pasteable for
`digest_sections`. Note `digest_sections` has an FK-referencing child table
(`digest_regenerations.section_id REFERENCES digest_sections(id) ON DELETE
CASCADE`) — the rebuild must preserve those rows too (compare with the
`ml_submissions__new` rebuild at `client.ts:47-92` which is a more elaborate
precedent involving a UNIQUE index).

**For The Guesser**: since it should NOT go into `digest_sections` (it's
deterministic, like `stats`), no CHECK-constraint change is needed for it —
it gets its own dedicated columns on `digest_drafts` (see §3) exactly like
`stats_position`/`stats_state`/`stats_content_json`.

### 1.3 Every place a new LLM kind string must be added (if Storylines joins `SECTION_KINDS`)

1. `ui/src/lib/digest/llm.ts:10` — `SECTION_KINDS` array.
2. `ui/src/lib/digest/llm.ts:476-483` — `SECTION_DESCRIPTIONS['storylines']`.
3. `ui/src/lib/digest/llm.ts:488-495` — `SECTION_DESCRIPTIONS_RECAP['storylines']` (even if just a stub/skip — Record types require all keys).
4. `ui/src/lib/digest/llm.ts:610-617` — `SECTION_SCHEMA['storylines']`.
5. `ui/src/lib/db/schema.ts:196` — CHECK constraint (`kind IN (...)`).
6. `ui/src/lib/db/client.ts` — table-rebuild migration for existing DBs (see §1.2).
7. `ui/src/routes/digest/[roundId]/+page.svelte:115-122` — local `SECTION_LABELS: Record<SectionKind, ...>` (display label / eyebrow text for the section header).
8. `ui/src/routes/digest/[roundId]/+page.svelte:647-654` — `VISUAL_COMPONENTS` registry (map `storylines` → its visual component, or omit for textual-only).
9. `ui/src/lib/digest/sectionState.ts:17-24` — `SECTION_LABELS` used by `ModelsScreen.svelte`'s per-section model-override UI (so it's selectable there too).
10. `ui/src/lib/digest/modelFor.ts` — `SECTION_BUCKET_MAP` (not opened above but referenced by `sectionState.ts:2`) likely needs a `storylines` bucket entry so `modelForSection()` resolves a model.
11. Anywhere that special-cases `SECTION_KINDS.length` counts (e.g. `ModelsScreen.svelte` comment `// digest (6)`) — cosmetic but worth updating.
12. `ui/src/lib/digest/pipeline.ts` (`resolvePipeline`, `DEFAULT_PIPELINE`) — imported by `llm.ts:6`; the default pipeline config likely needs to route the new kind into an EP (execution phase) group, or it silently falls into whichever group the pipeline's catch-all handles. Not fully read in this pass — inspect before implementing.

If Storylines is instead built as its own synthetic/data-driven section (own
dedicated `digest_drafts` columns, not touching `digest_sections` at all,
similar to `stats`), items 1-6 and 10-12 above are **avoided entirely** and
only the frontend registration (items 7-9, adapted) is needed. This is the
lower-risk path and mirrors how `stats` (deterministic + optional inline
edit) already works alongside the true LLM kinds — see §3.

---

## 2. Generation flow

### 2.1 Route: `POST /api/digest/[roundId]/draft`

`ui/src/routes/api/digest/[roundId]/draft/+server.ts:31-102`

Flow:
1. Look up round; parse body → `force` flag + `genParams` (`parseGenParams`, lines 143-175).
2. `shouldRegenerate(genParams, force)` decides cached-vs-fresh.
3. `ensureAlbumArt(db, roundId)` (best-effort).
4. `getStandings(db, roundId)` — always computed (used by the standings synthetic section regardless of cache/regen).
5. **Cached path** (`cached && !regenerate`, lines 60-71): returns the existing `digest_drafts` row + its `digest_sections` rows (with `backfillPodiumArt` patching podium album art in place) + standings. No LLM call.
6. **Fresh path** (lines 73-101):
   - `recomputePopularityProxies(db)`.
   - `gatherRoundData(db, roundId)` → `RoundData` (`llm.ts:103-278`) — pulls round/league, `roundSequence`/`priorRounds`, the `bundle` (cross-round facts), `submissions`, `votes` (voter, song, points, comment — **no submitter/competitor id join here**, just song title text), `chatMentions` (from `chat_mentions`/`chat_assignments`), `relContext`, and `chatHistory` (auto window via `roundChatWindow`/`getRoundMessages`, `llm.ts:246-255`).
   - `gatherSeasonData(...)` if recap mode.
   - `generateDraft(data, genParams, season)` → `DraftLLMOutput` (`llm.ts:828-973`): resolves the model **pipeline** (`resolvePipeline(pipeline, activeKinds, db)`), runs one or more OpenRouter calls per Execution Phase (EP) group, accumulates `{ sections: Record<SectionKind, unknown> }`, optionally fires "cover" (A/B) calls, and fills any missing active kind with an empty stub (`{ title: k, body: '', items: [] }`).
   - If `regenerate`, deletes prior drafts for the round (`DELETE FROM digest_drafts WHERE round_id = ?` — cascades to `digest_sections` via FK).
   - `writeDraft(db, roundId, data, output, ..., genParams)` persists everything.

### 2.2 `activeKindsForDraft` — the inclusion gate

`ui/src/lib/digest/llm.ts:659-669`:

```ts
export function activeKindsForDraft(data: RoundData, genParams?: GenParams): SectionKind[] {
  const disabled = new Set(
    (genParams?.sections ?? []).filter((s) => s.enabled === false).map((s) => s.id),
  );
  const hasChat = data.chatMentions.length > 0 || !!genParams?.pastedChat?.trim() || !!data.chatHistory?.trim();
  return SECTION_KINDS.filter((k) => {
    if (disabled.has(k)) return false;
    if (k === 'chat') return hasChat;
    return true;
  });
}
```

Pattern: every kind is included by default unless (a) the generate-modal
explicitly disabled it (`genParams.sections[].enabled === false`), or (b) a
kind-specific data-availability gate fails (only `chat` has one today, via
`hasChat`). **A new `storylines` kind would add a third branch**, e.g.:

```ts
if (k === 'storylines') return hasStorylineEvidence; // per-league opt-in AND evidence present
```

This is also where **per-league opt-in** must be threaded in if Storylines
joins `SECTION_KINDS` — `activeKindsForDraft` doesn't currently know the
league id/slug (it receives `RoundData`, which has `data.league.id` but not
`slug`); the opt-in check itself (like `chatSectionEnabledFor`) needs a
`leagueSlug` + `db`, neither of which `gatherRoundData`'s caller currently
threads into `activeKindsForDraft`'s signature. Whoever implements Storylines
will need to either (a) resolve the league slug inside `gatherRoundData`/
`RoundData` and pass `db` into `activeKindsForDraft`, or (b) filter the
`genParams.sections` disabled-set upstream in the API route based on the
league's opt-in setting (cleaner — mirrors how the chat section is gated
purely at the page-server layer today, see §5).

### 2.3 Content shape / storage: `writeDraft`

`ui/src/lib/digest/llm.ts:1065-1110`. For each active kind, in position
order:

```ts
const id = `${draftId}-${kind}`;
const variant = variantByKind.get(kind) ?? 'textual';
db.prepare(
  `INSERT INTO digest_sections (id, draft_id, kind, position, state, content_json, regen_count, variant)
   VALUES (?, ?, ?, ?, 'default', ?, 0, ?)`,
).run(id, draftId, kind, idx, JSON.stringify(output.sections[kind] ?? {}), variant);
```

`content_json` is **whatever JSON object the LLM returned for that kind**,
per the `SECTION_SCHEMA` prompt contract (e.g. `podium`: `{ title, items,
body }`; `chat`: `{ title, summary, moments: [{label, detail}] }`). There is
no DB-level schema on `content_json` beyond "valid JSON text" — the frontend
(`DigestSection.svelte`, `ChatMoments.svelte`, etc.) parses it defensively.

For a deterministic section like The Guesser, the equivalent "content" is
computed directly in TS (no LLM roundtrip) and can be shaped however the
renderer wants — see §3 for the `RoundInsights`/`stats_content_json` model.

### 2.4 `writeDraft`'s section-id convention

Section id = `${draftId}-${kind}` (e.g. `draft-42-a1b2c3d4-podium`). The
`sections/[id]/+server.ts` PATCH endpoint hard-codes a special case for the
literal string `"stats"` as a sentinel id (not `${draftId}-stats`) because
`stats` isn't a `digest_sections` row at all — it lives on `digest_drafts`
columns. This is the precedent to follow for The Guesser's PATCH endpoint
(see §3.3 / §4).

---

## 3. Deterministic section precedent (the model for The Guesser)

There are actually **two** deterministic patterns in the codebase; The
Guesser should follow **Pattern A** below.

### Pattern A — `stats` / `RoundInsights` (dedicated `digest_drafts` columns)

**Compute**: `getRoundInsights(db, roundId): RoundInsights` —
`ui/src/lib/db/roundInsights.ts:124-370`. Pure read-only SQL + JS aggregation
over `ml_submissions`, `votes`, `song_audio_features`, `chat_mentions`,
`competitors`, `players`, cross-season `seasons`. Returns a typed object:
`{ audio, submissionTiming, artists: { callbacks: ArtistCallback[], topArtists, ... }, wordCloud }`.
No LLM call anywhere in this function. Helper functions (`median`, `rounded`,
`topCounts`, `firstArtist`) are local, small, and pure — good template for
The Guesser's own helpers (e.g. `computeGuesserLeaderboard`).

**Storage — NOT a `digest_sections` row.** Instead, 3 dedicated columns live
directly on `digest_drafts` (`ui/src/lib/db/schema.ts:185-189`):

```sql
stats_position INTEGER NOT NULL DEFAULT 0,
stats_state TEXT NOT NULL DEFAULT 'default',
stats_content_json TEXT NOT NULL DEFAULT '{}',
```

(`stats_state` has no CHECK constraint in the CREATE TABLE, unlike
`digest_sections.state` — validated only in application code, e.g.
`sections/[id]/+server.ts:34`.) These are added via `ALTER TABLE` migrations
in `client.ts:124-131` for pre-existing DBs. `stats_content_json` does NOT
hold the computed insights (those are recomputed live on every page load from
`getRoundInsights`) — it holds only a small **user-editable caption**
override: `{ title?: string; body?: string }` (see `+page.server.ts:239-240`,
`RoundInsights.statsContent`). The heavy computed payload
(`RoundInsights`) is never persisted; it's recomputed on each `load()`.

**Page-server wiring** (`ui/src/routes/digest/[roundId]/+page.server.ts:311`):

```ts
const insights = { ...getRoundInsights(db, roundId), roundId, topSectionVariant: draft.top_section_variant, topSectionVisuals: coerceTopSectionVisuals(savedVisuals), statsContent };
```

Also exposed standalone via `GET /api/digest/[roundId]/insights` →
`ui/src/routes/api/digest/[roundId]/insights/+server.ts:4-13` (`json({ insights: getRoundInsights(db, roundId) })`).

**Availability gating** happens client-side, not server-side:
`+page.svelte:685-691`:

```ts
const statsAvailable = $derived(
  !!statsData && (recap
    ? Object.values(statsData).some((v) => typeof v === 'number')
    : !!statsData.audio && (!!statsData.audio.analyzedSongs || !!statsData.wordCloud?.length || !!statsData.artists?.songCount)),
);
const showStats = $derived(statsAvailable);
```

**PATCH endpoint**: `ui/src/routes/api/digest/[roundId]/sections/[id]/+server.ts:19-47`
special-cases `sectionId === "stats"` and writes straight to the
`digest_drafts` row's `stats_content_json`/`stats_state`/`stats_position`
columns rather than touching `digest_sections`.

**Rendering**: `+page.svelte:1522-1539` (the `{#if section.kind === "stats"}`
branch inside the `{#each renderSections as section}` loop) — `section.kind
=== 'stats'` is a **synthetic entry spliced into `renderSections`**, not a
DB-fetched `digest_sections` row:

```ts
const renderSections = $derived(
  [
    ...sectionsList,
    ...(!recap && showStats ? [{ id: "stats", kind: "stats", position: data.draft.stats_position ?? 0, content: data.insights?.statsContent ?? {}, variant: "visual" }] : []),
  ].sort((a, b) => a.position - b.position),
);
```

Then it renders through the same `<DigestSection>` component as the LLM
kinds, with `visualComponent={VISUAL_COMPONENTS.stats}` → `DigestInsights`
(`+page.svelte:651`), and `content={section.content}` = the small editable
caption, while `visualData={statsData}` carries the FULL computed
`RoundInsights` object (this is the key distinction from LLM sections: LLM
sections pass their content through `content`, deterministic/visual sections
pass their heavy payload through the separate `visualData` prop and use
`content` only for the tiny human-editable caption override).

**"Round intelligence - deterministic" label**: `ModelsScreen.svelte:1114-1118`
— a static row (not tied to any model picker) inside the "Digest sections"
per-section-overrides card, explicitly noting this section needs no model:

```svelte
<div class="mlm-section-row mlm-section-row--deterministic">
  <span class="mlm-section-label">Round intelligence - deterministic</span>
  <span class="mlm-section-resolved">no model - computed from round data</span>
  <span class="mlm-section-label" style="font-size:11px;color:var(--fg-muted);">Visual set selected in Generate / regeneration options</span>
</div>
```

This is a hand-written informational row, not driven by `SECTION_LABELS` or
`SECTION_BUCKET_MAP` — a new deterministic section (The Guesser) should get
its own analogous static row here (or this row could be generalized to list
all deterministic sections).

### Pattern B — `ArtistCallback` (nested inside Pattern A's payload)

`ArtistCallback` (`roundInsights.ts:40-48`) is not a separate section — it's
one field (`artists.callbacks`) inside `RoundInsights`, computed by comparing
this round's first-listed artists against every earlier season's submissions
in the same league (`roundInsights.ts:225-298`). It demonstrates the
"cross-round/cross-season SQL join + JS sort/slice, capped result list"
technique The Guesser will need for its own leaderboards (e.g. "most guesses
correct all-time", "biggest single-round point swing").

### Recommendation for The Guesser

Copy Pattern A exactly:
1. New pure function `getGuesserData(db, roundId): GuesserData` in a new file
   e.g. `ui/src/lib/db/guesserInsights.ts` (or extend `roundInsights.ts`),
   computing leaderboards from `votes` + `ml_submissions` + player identities
   (see §6).
2. New `digest_drafts` columns: `guesser_position`, `guesser_state`,
   `guesser_content_json` (caption/override only, same shape idea as stats),
   added via `ALTER TABLE` in `client.ts` guarded by a `draftCols.some(...)`
   check exactly like `stats_position` (`client.ts:124-131`).
3. Wire into `+page.server.ts` alongside `getRoundInsights` (new
   `getGuesserData` call, gated by a **per-league opt-in setting** — see §5 —
   unlike `stats` which has no opt-in gate today).
4. Splice a synthetic `{ id: 'guesser', kind: 'guesser', position, content, variant: 'visual' }` entry into `renderSections` in `+page.svelte`, gated by availability (`showGuesser`) AND the per-league opt-in flag.
5. New PATCH branch in `sections/[id]/+server.ts` for `sectionId === "guesser"` mirroring the `"stats"` branch.
6. New visual component (e.g. `GuesserLeaderboard.svelte`) registered in `VISUAL_COMPONENTS.guesser`.
7. Add a `SECTION_KINDS`-independent label to `SECTION_LABELS` in `+page.svelte` is NOT needed since it's synthetic like stats (stats also isn't in that Record's type but is special-cased in the template, not looked up via `SECTION_LABELS[...]`) — confirm at implementation time whether `kindOrFallback`/`SECTION_LABELS[kindOrFallback(section.kind)]` is reached for `kind === 'guesser'`; the current code special-cases `kind === "stats"` BEFORE that lookup (`+page.svelte:1523` `{#if section.kind === "stats"}` short-circuits), so `guesser` needs the same short-circuit `{:else if section.kind === "guesser"}` branch.

This entirely avoids touching `SECTION_KINDS`, the `digest_sections` CHECK
constraint, the LLM prompt/schema, and the pipeline/model-routing system —
The Guesser never talks to an LLM.

---

## 4. Rendering

### 4.1 Dispatch loop

`ui/src/routes/digest/[roundId]/+page.svelte:1522-1572`, inside
`{#each renderSections as section (section.id)}`:

```svelte
{#if section.kind === "stats"}
  <DigestSection kind="stats" ... visualComponent={VISUAL_COMPONENTS.stats} visualData={statsData} ... />
{:else}
  <DigestSection
    kind={kindOrFallback(section.kind)}
    label={SECTION_LABELS[kindOrFallback(section.kind)]}
    sectionState={sectionStates[section.id] ?? 'default'}
    content={section.content}
    ...
    visualComponent={VISUAL_COMPONENTS[kindOrFallback(section.kind)]}
    ...
  />
{/if}

{#if section.kind === 'chat' && chatData.section}
  <ChatLabSection data={chatData.section} recommendations={chatData.recommendations} ... />
{/if}
```

`kindOrFallback` (`+page.svelte:1201-1203`) coerces any kind not literally
present in `SECTION_KINDS` to `'flow'` — **this is why a synthetic kind like
`stats` must be special-cased with its own `{#if}` branch BEFORE reaching the
generic `{:else}` path**; otherwise a `guesser` kind would silently render
using the `flow` label/visual component. `chat` gets a second, sibling render
(`ChatLabSection`) directly after its `DigestSection`, driven by matching on
`section.kind === 'chat'` — this is the closest existing precedent for
"render an LLM-authored `DigestSection` PLUS an adjacent deterministic block
underneath it", which is exactly Storylines' shape (LLM prose narrative +
possibly a deterministic evidence/quotes block rendered alongside it).

### 4.2 Components per kind

`VISUAL_COMPONENTS` registry, `+page.svelte:647-654`:

```ts
const VISUAL_COMPONENTS: VisualRegistry = {
  podium: AlbumPodium,
  chat: ChatMoments,
  standings: StandingsChart,
  stats: DigestInsights,
  discoverability: TastemakerSection,
  nextRound: NextRoundPreview,
};
```

Kinds without a visual component entry (`villain`, `flow`, `consensus`,
`quotes`) fall back to `VariantPlaceholder` inside `DigestSection.svelte`
(text-only rendering of `content.title`/`.body`/`.items`) — confirmed by the
comment at `+page.svelte:641-646` ("Until a kind is registered, its visual
slot falls back to VariantPlaceholder"). `ChatMoments.svelte` (`ui/src/lib/digest/ChatMoments.svelte:1-80+`)
is the template for a hand-built visual renderer of a restructured LLM JSON
shape (`{ summary, moments: [{label, detail}] }`), including export-mode
(`?export=1`) vs interactive-web dual rendering — Storylines' LLM writeup
should follow this same `{ summary?, cast: [{...}] }`-style restructured
shape + a dedicated component, rather than raw prose.

### 4.3 `content_json` parse → component prop path

`+page.server.ts:230-237`, at load time:

```ts
const sections = getSectionsForDraft(db, draft.id).map((s) => ({
  ...s,
  content: parseContent(s.content_json),   // JSON.parse, fallback {body: json} on parse error
  variant: (... 'textual' | 'visual' | 'both'),
}));
```

`parseContent` (`+page.server.ts:420-426`) is a trivial `JSON.parse` with a
`{ body: json }` fallback. This parsed `content` is what flows into
`<DigestSection content={section.content} .../>` and, inside that component,
into whichever `visualComponent` is registered — components receive `content`
(the parsed object) as a prop per `VisualComponentProps` (see
`ChatMoments.svelte:31` — `let { content }: VisualComponentProps = $props();`).

For a **deterministic visual section** (Guesser/stats pattern), the heavy
computed payload does NOT travel through `content_json`/`content` at all —
it travels through the separate `visualData` prop, fetched fresh server-side
on every load (`data.insights` for stats) rather than persisted as JSON in
the DB. `content` for these sections holds only the small user-editable
override/caption.

### 4.4 What a new `guesser` render path needs

1. Splice `{ id: 'guesser', kind: 'guesser', position, content, variant: 'visual' }` into `renderSections`.
2. New `{:else if section.kind === "guesser"}` branch (or extend the existing `{#if section.kind === "stats"}`) in the render loop, passing `visualComponent={VISUAL_COMPONENTS.guesser}` and `visualData={guesserData}`.
3. New Svelte component (e.g. `GuesserLeaderboard.svelte`) implementing `VisualComponentProps`, reading `data`/`visualData` (leaderboard rows) not `content`.
4. Register in `VISUAL_COMPONENTS.guesser`.
5. Add availability gating (`showGuesser` `$derived`) plus opt-in gating from §5.

### 4.5 What Storylines needs

If built as an LLM `SECTION_KINDS` member (`'storylines'`):
- Everything in §1.3 items 1-9.
- A new visual component (e.g. `StorylinesCast.svelte`) mirroring `ChatMoments.svelte`'s restructured-JSON + web/export dual-mode pattern, registered as `VISUAL_COMPONENTS.storylines`.
- `content_json` shape defined in `SECTION_SCHEMA.storylines`, e.g. `{ title, cast: [{ name, headline, evidence: [quote, ...] }] }`.
- Because it's LLM-authored, it also gets full support "for free" from the existing regen modal, cover A/B system, cost ledger, and per-section model override — **if** it's added to `SECTION_KINDS`.

If built as a hybrid (deterministic evidence-gathering function feeds a
one-off/non-`SECTION_KINDS` LLM call outside the standard pipeline, similar
to how `chatSection.ts`'s deterministic superlatives are wholly separate from
the LLM `chat` kind, but with a bespoke prose write-up bolted on): more
implementation freedom, but loses the regen-modal / cover-AB / cost-ledger
integration unless hand-wired. **This tradeoff should be an explicit decision
in the Storylines implementation plan** — this research doc does not resolve
it, only lays out both paths.

---

## 5. Per-league opt-in

### 5.1 `chatSectionEnabledFor` / `CHAT_SECTION_DEFAULTS` (source of truth pattern)

`ui/src/lib/digest/chatSection.ts:256-310`:

```ts
export const CHAT_SECTION_DEFAULTS: Record<string, boolean> = {
  'boarz-ii-men': true,
  'second-best': false,
  'fam-jam': false,
  'hip-jammers': false,
  'nostalgia-pit': false,
  'sssc': false,
};

const SETTINGS_KEY = 'chat_section_leagues';

export function chatSectionEnabledFor(db: Database.Database, leagueSlug: string): boolean {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as { value?: string } | undefined;
    const saved = row?.value ? (JSON.parse(row.value) as Record<string, boolean>) : {};
    if (leagueSlug in saved) return !!saved[leagueSlug];
  } catch { /* fall back to defaults */ }
  return CHAT_SECTION_DEFAULTS[leagueSlug] ?? false;
}

export function setChatSectionEnabled(db, leagueSlug, enabled): void { ... } // upserts into settings.chat_section_leagues (JSON blob)
```

Storage: a single row in the generic `settings` key/value table
(`settings.key = 'chat_section_leagues'`, `value` = JSON map of
`{ [leagueSlug]: boolean }`). No dedicated table/column. Defaults live in a
hardcoded `Record<string, boolean>` keyed by league slug, all `false` except
one manually-verified league (`boarz-ii-men`).

### 5.2 Where the digest server calls it

`ui/src/routes/digest/[roundId]/+page.server.ts:246-309` (inside the `try`
block building `chatSection`):

```ts
const league = db.prepare('SELECT slug FROM leagues WHERE id = ?').get(round.league_id) as { slug?: string } | undefined;
const groupName = league?.slug ? (getChatSettings(db).leagueGroupMap[league.slug] ?? '') : '';
const enabled = league?.slug ? chatSectionEnabledFor(db, league.slug) : false;
if (groupName && enabled) {
  // ... build chatSection via buildChatSection(...)
}
```

Gating is entirely server-side in `+page.server.ts`'s `load()` — if disabled,
`chatSection` stays `null` and the client never even receives a payload
(`chatData.section` is `null`, and the `{#if section.kind === 'chat' &&
chatData.section}` guard on the client, `+page.svelte:1564`, simply doesn't
render the deterministic sub-block). Note the LLM `chat` **prose** kind
(podium-style `digest_sections` row) is gated separately, purely on data
availability (`hasChat` in `activeKindsForDraft`, §2.2) — it has NO
per-league opt-in today. Only the deterministic chat-superlatives sub-block
is opt-in gated.

### 5.3 Pattern for the two new sections

Add two more settings keys (or extend one JSON blob with sub-keys), e.g.:

```ts
export const GUESSER_SECTION_DEFAULTS: Record<string, boolean> = { /* all leagues: false */ };
const GUESSER_SETTINGS_KEY = 'guesser_section_leagues';
export function guesserSectionEnabledFor(db, leagueSlug): boolean { /* same shape as chatSectionEnabledFor */ }

export const STORYLINES_SECTION_DEFAULTS: Record<string, boolean> = { /* all leagues: false */ };
const STORYLINES_SETTINGS_KEY = 'storylines_section_leagues';
export function storylinesSectionEnabledFor(db, leagueSlug): boolean { /* same */ }
```

Then in `+page.server.ts`'s `load()`, gate `getGuesserData(...)` /
Storylines-evidence-gathering behind these exactly like the chat block is
gated (server-side `if (enabled) { ... }`, else leave the field `null`), so
the client never sees a payload for a disabled league (defense in depth —
matches the codebase's existing "fail-closed, server decides" convention for
this specific gate).

For Storylines specifically, if it's implemented as a `SECTION_KINDS` member,
the opt-in ALSO needs to suppress it from `activeKindsForDraft` at generation
time (§2.2) — not just at render time — otherwise a disabled league would
still pay for and store an LLM-generated `storylines` `digest_sections` row
that the page then hides. The cleanest place to enforce this is inside the
API route (`draft/+server.ts`) before calling `generateDraft`, by pre-seeding
`genParams.sections` with `{ id: 'storylines', enabled: false }` when the
league's opt-in is off (mirrors how the modal's own per-section toggles are
threaded).

---

## 6. Vote comments access (for The Guesser)

### 6.1 Votes schema

`ui/src/lib/db/schema.ts:55-60`:

```sql
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES rounds(id),
  voter_id INTEGER NOT NULL REFERENCES competitors(id),
  spotify_uri TEXT NOT NULL, points INTEGER NOT NULL, comment TEXT, created_at TEXT NOT NULL,
  UNIQUE(round_id, voter_id, spotify_uri)
);
```

Columns: `voter_id` (→ `competitors.id`), `spotify_uri` (join key to the
submission, NOT a submission id FK), `points`, `comment`, `created_at`. No
`player_id` FK column on `votes` shown in the base `CREATE TABLE` — check
`client.ts:337` (`ALTER TABLE votes ADD COLUMN player_id INTEGER REFERENCES players(id)` under the sprint-25 fk-migration block) — **`votes.player_id` exists via migration on real DBs**, giving a direct player link without going through `competitors`.

### 6.2 Resolving the actual submitter

`ml_submissions.competitor_id → competitors.id`, and `competitors.player_id`
(added via migration, `client.ts:304`, backfilled by matching
`ml_competitor_id`) → `players.id`. The existing query pattern used
throughout `llm.ts`/`roundInsights.ts` joins `ml_submissions` to
`competitors` (`LEFT JOIN competitors c ON c.id = m.competitor_id`) and
reads `c.name`; `roundInsights.ts:132` additionally prefers
`COALESCE(p.name, c.name)` by joining `players p ON p.id = s.player_id` (the
submission's own `player_id`, migrated onto `ml_submissions` per
`client.ts:330`). For The Guesser, the canonical "who actually submitted this
song" query is:

```sql
SELECT m.spotify_uri, m.title, m.artists,
       COALESCE(p.name, c.name) AS actual_submitter,
       c.id AS competitor_id, p.id AS player_id
FROM ml_submissions m
LEFT JOIN competitors c ON c.id = m.competitor_id
LEFT JOIN players p ON p.id = m.player_id
WHERE m.round_id = ?
```

(Both `ml_submissions.player_id` and `competitors.player_id` exist per
migrations; prefer the direct `ml_submissions.player_id` join as
`roundInsights.ts` does.)

### 6.3 Resolving a guessed nickname → player

This is what `player_identities` is for, but it does NOT map free-text
nickname guesses directly — it maps a **chat platform identifier** (WhatsApp
number, Google Chat id, Discord id, Music League name) to a `player_id`,
scoped optionally to a `league_id`:

`ui/src/lib/db/client.ts:266-280` (base table) + `client.ts:593-613`
(discord-widening migration):

```sql
CREATE TABLE player_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  league_id INTEGER REFERENCES leagues(id) ON DELETE SET NULL,
  identity_type TEXT NOT NULL CHECK(identity_type IN ('whatsapp','google-chat','music-league','discord')),
  identifier TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

This table resolves "who sent this WhatsApp message" (§7 uses it via
`buildChatRoster` in `chatSection.ts:397-403`), NOT "who does the nickname
'Big Sipp' in a vote comment refer to". **There is no existing free-text
nickname → player resolver in the codebase found in this pass.** The Guesser
needs a NEW small nickname-resolution layer, most naturally built as:

1. A per-league alias/nickname map (could reuse `player_identities` with a
   NEW `identity_type` value, e.g. `'nickname'` — requires the same
   CHECK-widening migration pattern as §1.2/discord — or a separate small
   table `player_nicknames(player_id, league_id, nickname)`).
2. Fuzzy/normalized matching (lowercase, strip punctuation — same technique
   as `roundInsights.ts`'s `firstArtist`/token-normalization, or
   `chatRoster.ts`'s sender resolution — not opened in this pass but
   referenced at `chatSection.ts:13`, worth reading before implementing).
3. Applied against `votes.comment` text to extract "I think this is X's
   song" guesses — this is free-text parsing, likely needing either simple
   regex heuristics or an LLM extraction pass (which would make part of The
   Guesser NOT purely deterministic — worth flagging explicitly to the
   product owner: if guess-detection itself requires LLM parsing of comment
   text, "The Guesser" is only deterministic in its SCORING/leaderboard step,
   not its extraction step, unless guesses are captured via a structured
   mechanism elsewhere, e.g. a poll feature — see the
   `project_guess_the_submitter_game` memory note referenced in session
   context, which describes an "Approach A" bot-as-participant poll game
   already ratified for a related feature; The Guesser section may be
   intended to leaderboard THAT poll's results rather than parse vote
   comments at all — confirm requirements before assuming vote-comment
   text-mining is in scope).

### 6.4 Play order = `ORDER BY spotify_uri`

No file in this pass explicitly implements "play order" as `ORDER BY
spotify_uri`, but this was given as fact in the task prompt — it should be
treated as ground truth for The Guesser's song-sequencing needs (e.g. "song
#3 in the playlist") rather than re-derived. Cross-reference against
`gatherRoundData`'s `subRows` query (`llm.ts:196-217`), which orders by
`vote_total DESC` (rank order, not play order) — The Guesser will need its
own query ordering explicitly by `spotify_uri` if it needs to reconstruct
playlist/play order, e.g.:

```sql
SELECT m.spotify_uri, m.title, m.artists, m.competitor_id
FROM ml_submissions m
WHERE m.round_id = ?
ORDER BY m.spotify_uri
```

---

## 7. Storylines source (chat window + vote comments)

### 7.1 Chat windowing

Two related-but-distinct chat window helpers:

**A. `roundChatWindow` + `getRoundMessages`** (used by `gatherRoundData` for
the LLM `chat` kind's auto-fetch) — `ui/src/lib/chat/historyQuery.ts:173-208`
and `:54-79`:

```ts
export function roundChatWindow(db, roundId): { groupName: string; fromIso: string; toIso: string } {
  // round.created_at → next round's created_at (or now); leagueGroupMap[slug] for groupName;
  // optional buffer-day padding via chat_round_boundary/chat_buffer_days settings.
}
export function getRoundMessages(db, groupName, fromIso, toIso, opts?): ChatMessage[] {
  // SELECT id, platform, group_name, sender, text, ts FROM chat_messages WHERE group_name=? AND ts BETWEEN fromIso/toIso ORDER BY ts ASC
}
```

Used in `llm.ts:246-255`:

```ts
const win = roundChatWindow(db, roundId);
let chatHistory: string | undefined;
if (win.groupName) {
  const msgs = getRoundMessages(db, win.groupName, win.fromIso, win.toIso);
  if (msgs.length) {
    chatHistory = msgs.map((m) => `[${m.ts}] ${m.sender}: ${m.text...}`).join('\n');
  }
}
```

This window is bounded by **round creation dates** (this round's
`created_at` to the next round's `created_at`), NOT voting deadlines.

**B. `chatWindowFor`** (used by the deterministic `chatSection.ts` /
superlatives system) — `ui/src/lib/digest/chatSection.ts:35-53`:

```ts
export function chatWindowFor(roundEndIso, previousRoundEndIso, windowDays = 7): ChatWindow | null {
  // from = previousRoundEndIso (or roundEndIso - windowDays) to roundEndIso
}
```

This window is bounded by **voting deadlines** (`round.voting_deadline`),
used by `buildChatSection` (`chatSection.ts:379-441`), which itself calls
`loadChatWindow(db, groupName, window)` (`chatSection.ts:100-142`) — a
different, dedicated query over `chat_messages` (`WHERE group_name = ? AND ts
>= ? AND ts < ?`) that ALSO filters relay placeholder artifacts
(`PLACEHOLDER_RE`) and shifts to local wall-clock time via `tzOffsetMinutes`.

**For Storylines**, prefer **Pattern B's window** (`chatWindowFor` +
`loadChatWindow`) since it's already voting-deadline-bounded, placeholder-
filtered, and timezone-correct — better evidence quality than Pattern A's
cruder created_at-to-created_at window. Reuse `buildChatRoster` (referenced
at `chatSection.ts:13`, not opened in this pass) to resolve `sender` names to
players via `player_identities` for evidence attribution.

### 7.2 Vote comments as evidence

Direct query (no existing helper function found bundling "votes with
comments for a round" beyond `gatherRoundData`'s `voteRows`,
`llm.ts:219-227`, which already does exactly this):

```sql
SELECT c.name AS voter, m.title AS song, v.points, v.comment
FROM votes v
JOIN competitors c ON c.id = v.voter_id
JOIN ml_submissions m ON m.round_id = v.round_id AND m.spotify_uri = v.spotify_uri
WHERE v.round_id = ?
```

Filter to `v.comment IS NOT NULL AND TRIM(v.comment) <> ''` for evidence
quotes (mirrors `roundInsights.ts:141-150`'s `commentEntries` query, which
UNIONs vote comments AND submission comments — Storylines may want both
sources too, tagged by type, similar to `roundInsights.ts`'s
`comment`/`chat`-tagged word-cloud entries at `roundInsights.ts:362-368`).

### 7.3 Assembling per-player evidence for the "cast"

Recommended shape, following `chatSection.ts`'s `ComputeOptions.resolve`
pattern for sender→player resolution and `roundInsights.ts`'s
cap-and-sort-then-slice technique: for each player active in a round (voter
or submitter), gather (a) their vote comments this round, (b) chat messages
attributed to them in the window (via roster resolution), (c) any relevant
callback data from `RoundBundleEntry`/`ArtistCallback` for cross-round color.
Then hand a BOUNDED, curated evidence bundle (not the raw chat dump) to a
thin LLM prompt — analogous to how `buildUserPrompt` assembles bounded,
labeled evidence blocks (`# Votes`, `# Chat mentions`, etc., `llm.ts:740-774`)
rather than dumping full DB rows. This keeps Storylines' LLM call cheap and
scoped, in contrast to the full-round-dump prompt the 6 existing
`SECTION_KINDS` share.

---

## Open questions / risks flagged for the implementation plans

1. **Storylines: `SECTION_KINDS` member vs. standalone synthetic section?**
   Determines whether items in §1.3 apply. Recommend deciding this first —
   it's the single biggest fork in implementation cost.
2. **`digest_sections.kind` CHECK widening migration** must preserve
   `digest_regenerations` FK rows (cascade-delete risk during table rebuild)
   if Storylines becomes a `digest_sections` row — verify against the
   `player_identities` migration's simpler (no child-FK) precedent before
   copying it verbatim.
3. **The Guesser's "guess" data source is unclear from the codebase alone** —
   confirm whether guesses come from free-text vote-comment mining (would
   require an LLM/regex extraction pass, undermining "fully deterministic")
   or from a structured poll/game mechanism (the
   `project_guess_the_submitter_game` feature referenced in session memory)
   before writing the implementation plan.
4. **`activeKindsForDraft` has no `db`/league-slug parameter today** — adding
   a data-availability-AND-opt-in gate for `storylines` (if added to
   `SECTION_KINDS`) requires either threading more context into that
   function or pre-filtering `genParams.sections` at the API-route layer
   (recommended — least invasive).
5. **`sectionState.ts`'s `SECTION_LABELS`/`SECTION_BUCKET_MAP`** need
   inspection of `ui/src/lib/digest/modelFor.ts` (not opened in this pass)
   before finalizing how Storylines gets a model bucket / pipeline routing
   entry.
6. **Nickname→player resolution** for The Guesser has no existing helper;
   plan for new schema (nickname table or CHECK-widened `player_identities`)
   and a normalization/matching utility, following the discord-migration
   CHECK-widening precedent if extending `player_identities`.
