<!-- Song Metadata Queue panel — brief for Claude Design · 2026-06-24 -->
# Brief for Claude Design — The Song Metadata Queue panel

## What we're trying to do
The **Song Metadata Queue** panel (Settings screen) is the operator's window into the
enrichment pipeline that fills in each song's metadata. Functionally it works, but it's a
**visual jumble**: the colors fight each other, the numbers are ambiguous, the status
language is misleading (sometimes it makes progress look like regression), the round filter
is anemic, key controls appear/disappear, and the bottom "retry" area is a mess. We want a
**redesign** from you: a clear visual language for status, a sensible information hierarchy,
interactive metrics, and ideally a novel **nested progress visualization** for the natural
hierarchy of the data.

We want a **design** (layout, component structure, color/status language, the hierarchy
concept, interaction model), not code yet.

## Repo & where this lives
- GitHub: `git@github.com:loydmilligan/music-league-bot.git`
- Panel: `ui/src/routes/settings/+page.svelte` (the "Song Metadata Queue" `<section>`)
- Status/StatusChip: `ui/src/lib/components/StatusChip.svelte` (tones: accent / health / muted / warn)
- Data API: `ui/src/routes/api/metadata-queue/{status,retry,fill-gaps}/+server.ts`
- Data model: `ui/src/lib/db/metadataQueue.ts` (`getQueueStatus`, `getDigestReadiness`, `getCoverageMatrix`)
- Design tokens: `ui/src/lib/shortlist/colors_and_type.css`

## Ground-truth data model (so the redesign is accurate)
The queue has **one row per (song × job_type)** in `song_metadata_queue`. A row has a
status: `pending | processing | done | failed`. There are **5 job types**, from **4
different providers**, with very different speeds:

| Job type | Panel name | Provider/source | Speed | Note |
|---|---|---|---|---|
| `ytm` | YTM playlist links | Songlink | fast | link lookup |
| `lastfm_pop` | Tastemaker popularity | **Last.fm** | fast | listeners/playcount → obscurity; **shares Last.fm rate-limit with tags** |
| `lastfm_tags` | Genre & mood tags | **Last.fm** | fast | top tags; same source + rate-limit as popularity |
| `lyrics` | Lyrical metrics | LRCLIB | fast | presence today |
| `audio` | Audio insights (bpm/key/energy) | sintel/librosa | **slow, 2–10m, 1 concurrent** | the outlier |

So the 5 categories are **not homogeneous**: two share a source (Last.fm) and a rate-limit,
one is slow/local, one is a link lookup, one is lyrics. The current flat list of 5 identical
rows hides all of that — a redesign should make the groupings/relationships legible.

## The natural hierarchy (and the headline ask)
The data is deeply nested:

```
All of Music League
└─ Leagues
   └─ Seasons
      └─ Rounds
         └─ Songs
            └─ 5 metadata elements each  (ytm, pop, tags, lyrics, audio)
```

**We'd love a nested/hierarchical progress visualization** for this — a single element that
communicates completion at every level and lets you drill down. Candidate patterns to
consider (pick/combine/invent):
- **Nested/segmented rings** (sunburst): outer = leagues, inner rings = seasons → rounds, center = overall %.
- **Icicle / treemap** of coverage, sized by song count, colored by completion.
- **Drill-down accordion** with a roll-up progress bar at each level (ML → league → season → round → song), each bar segmented by the 5 job types.
- **Coverage heatmap**: rounds (rows) × the 5 metadata types (cols), cells = % done (we already compute a per-song version in `getCoverageMatrix`).

Please propose a concept (or two) and show how it scales from "all of Music League" down to
"this one song's 5 elements."

## The specific problems to fix (with the ground truth behind each)

### 1. The status color language is backwards and alarming (highest priority)
Current logic (`jobChipTone`/`jobChipLabel` in `+page.svelte`):
- `failed > 0` → **warn (yellow)**, label "N FAILED"
- `processing || pending > 0` → **accent (reads RED in our theme)**, label "RUNNING" / "N QUEUED"
- all done → **health (green)**, "DONE"
- no rows → muted (grey), "NO DATA"

The operator's lived experience (verbatim): *"tastemaker popularity shows 611/613 with 2
FAILED in yellow — makes sense. But when I retry those, the failed count drops and the bar
flips from yellow FAILED to **red QUEUED** — it feels like something got WORSE. Then RUNNING
is also red. Running is red?! It's a visual jumble."*

Root cause: **the in-progress states (queued/running) use the same red as reads-like-an-alarm**, and yellow→red is perceived as a regression even though it's progress. **Design a proper status ladder** where the color monotonically reflects progress, e.g.:
`grey (not started) → in-progress (calm blue + subtle motion for "running") → green (done)`,
with **yellow/red reserved exclusively for real problems (failed)**. "Running" should read as
*active/good*, not *alarm* — use subtle motion (pulse/shimmer/flowing bar) rather than an
alarm color. When the last failure clears, the state should visibly **improve** toward done,
never jump to a scarier color.

### 2. Ambiguous numbers — say what's being counted
- The big **"FAILURES 441 · needs retry"** tile counts **failed queue rows = (song × job_type) pairs = metadata elements, NOT songs.** One song can contribute up to 5. The operator asked exactly this ("does 441 mean songs or metadata elements?") — the UI must answer it inline (e.g., "441 metadata jobs across ~N songs").
- The **per-row fractions** (e.g., `611/613`): denominator = total songs enrolled for that job in scope; numerator = **completed** (`total − pending − processing − failed`). Failed = the job exhausted its retries (max 3) and gave up. Make this self-evident (tooltip/legend/labels) — today nothing explains numerator vs denominator vs "failed."
- The **"Done (24h)"** tile is windowed to the last 24h while the other tiles (pending/processing/failures) are lifetime — an apples-to-oranges mix. Reconcile or label clearly.

### 3. Metrics should be interactive in expected ways
The operator: *"the big FAILURES 441 · needs retry should be clickable — it should filter the
view to show what those 441 are made of."* Generally: **make the visible metrics the
controls.** Clicking "Failures" filters to failures; clicking a job-type row filters to that
job; clicking a round drills in. Visual = interactive, where the affordance is obvious.

### 4. Round filter is anemic
Today the scope selector only lists `data.recentRounds` (recent rounds) — you **can't select
arbitrary past rounds**. Needs: all rounds, grouped/filterable by **league → season →
round**, with search, and a clear "All" scope. (This is also the hierarchy from above — the
filter and the progress viz could be the same drill-down element.)

### 5. "Fill gaps" should always be available
The "Fill gaps · enrich N" button only appears **per-round, and only when that round is
blocked**. It vanishes on the "All rounds" scope (the operator specifically flagged this).
It should be **consistently present** — including an **all-scope "enrich everything missing"**
action. (Backend note: an all-rounds fill path doesn't exist yet; the design should assume
it will.)

### 6. The bottom retry section is bad
A collapsible **giant flat list of retryable song/tracks**, headed by "Failures (N) ·
**M retries used**." Two problems:
- The list is unstructured and overwhelming — should be grouped (by round? by job type? by
  error reason?), filterable, with bulk actions (retry all of X), and tied to the filter
  state from #3.
- **"retries used" is a meaningless, anxiety-inducing metric** to surface ("should I not use
  so many?"). It's an internal worker counter (each job auto-retries up to 3× before being
  marked failed). **Drop it** from the operator UI, or replace with something actionable
  (e.g., "why it failed": no-data vs rate-limited vs transient).

### 7. Make meaning obvious; guide the eye
The operator wants the panel to **use color, styling, depth, and subtle motion** (gentle
pulse/shine/flow — nothing flashy) to direct attention, show where to look, and make the
current state instantly understandable. Today there's lots of visual stuff but little of it
*means* anything legible.

## What we'd love from you
1. A **status/color language** (the ladder in #1) applied consistently across chips, bars, and tiles — with motion reserved for "running," and alarm colors reserved for real failures.
2. The **nested hierarchy progress concept** (ML → leagues → seasons → rounds → songs → 5 elements) — a concrete visualization, ideally doubling as the scope filter.
3. A **redesigned panel layout**: legible metrics (that say what they count), interactive metrics-as-filters, an always-present enrich/fill control, and a structured retry area.
4. A **legend/affordance model** so numerator/denominator/failed and the 5 job types' relationships are self-explanatory.
5. Visual direction consistent with our tokens (`--mash-pulp` accent, `--moss`, `--amber`, `--sky`, `--ember`).

Goal restated: turn a working-but-incomprehensible status panel into one where the operator
**instantly knows what's done, what's running, what's broken, and what to click** — across
the whole Music-League hierarchy.
