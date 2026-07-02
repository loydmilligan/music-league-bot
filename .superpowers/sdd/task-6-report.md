# Task 6 Report — Sonic Signature v2: Admin settings panel + live sample + apply-to-live

## Status
COMPLETE

## Commit
`7946d3f` — `feat(settings): system-wide Taste Waveform config with live sample + apply-to-live`

## Verification summary
- `cd ui && npm run check` → **0 errors**, 57 warnings (all pre-existing; 1 new a11y warning on the toggle switch button which is cosmetic only).
- Endpoint patch logic verified via throwaway node script: copied `digests/LTpXjdZs2iax5N7aSb1HeQ/read_model.json` to scratchpad, simulated the POST patch, confirmed `rm.taste.settings` was written correctly with all 12 fields.

## What was built

### `ui/src/routes/api/settings/taste/+server.ts` (new)
- `GET` → `json(getTasteSettings(db))` — returns current settings or defaults.
- `POST` → zod-validates the 12-field `TasteSettings` body, inserts into `settings` table with key `taste_settings`, then for each `dashboard_sites` row patches `DIGESTS_DIR/<slug>/read_model.json` on disk and the `read_model` DB column (sets `rm.taste.settings = body`). Per-site errors caught silently. Returns `{ ok: true, patched: <count> }`.

### `ui/src/routes/settings/setup/+page.svelte` (modified)
- `onMount` fetches `/api/settings/taste` and `/api/history/taste` in parallel.
- Derived `sampleEng` recomputes from `sampleBlock` + live `tasteSettings` on every control change.
- "Taste Waveform" section appended at page bottom: segmented signal control, range sliders (votePct, dnPct, lyrWeight, spread), toggle switches for 7 booleans, live `<TasteWaveform variant="card">` preview, Save button with patched-count confirmation chip.

## Concerns
- **11 commits ahead of origin/master** (just crossed the 10-commit threshold). Consider pushing.
- `DIGESTS_DIR` defaults to `'digests'` (relative) for local dev; prod sets `/app/digests` via env — matches convention in `publish.ts`/`export.ts`.
- Full live verification (curl POST on prod, confirm read_model file updated) deferred to Task 7 deploy.

---

## Review fix pass — commit `9ab0c0f`

### Findings addressed

**I-1 — rm.taste upsert when absent**
Changed the guard in both the disk-file and DB-column patch paths from:
```ts
if (rm.taste && typeof rm.taste === 'object') { (rm.taste as ...).settings = settings; }
```
to:
```ts
rm.taste = rm.taste && typeof rm.taste === 'object' ? rm.taste : {};
(rm.taste as Record<string, unknown>).settings = settings;
```
This creates the `taste` key when absent rather than silently skipping the site.

**I-2 — accurate `patched` counter**
Restructured per-site tracking with a `SiteOp` record that carries `diskWritten` and `dbUpdated` boolean flags. `patched` is computed at the end as `siteOps.filter(op => op.dbUpdated && op.diskWritten).length`, so a site only counts if both its disk write and DB update fully succeeded.

**I-3 — atomic DB writes**
Moved the `settings` INSERT OR REPLACE and all `dashboard_sites` UPDATE statements inside a single `db.transaction(() => { ... })()`. Disk writes remain outside the transaction (filesystem isn't transactional) with per-site try/catch. The structure is now: (1) read disk + DB to compute new JSON strings, (2) transaction: settings insert + all DB updates, (3) disk writes, (4) count patched.

**M-1 — redundant `{@const}` in setup page**
Changed `{#each [...] as items}` + `{@const item = items}` to `{#each [...] as item}` directly. The body already used `item.*` throughout so no further changes were needed.

### Typecheck result
`cd ui && npm run check` → **0 errors**, 57 warnings (all pre-existing, none introduced by this fix).

### Upsert re-verification
Script: `/tmp/.../scratchpad/verify_upsert.mjs`
Command run: `node verify_upsert.mjs`
Output:
```
Before deletion — rm.taste exists: true
After deletion — rm.taste exists: false
Re-read — rm2.taste before patch: undefined
After patch — rm2.taste: {"settings":{"signal":"all","votePct":5,"negatives":true}}
PASS: rm2.taste.settings created? true
```
Confirms the I-1 upsert logic creates `rm.taste.settings` on a real `read_model.json` that had its `.taste` key deleted.

---

# Task 6 (collapsible panels) Report

## Status: DONE

**Commit:** b1ee15b  
**Check result:** `0 ERRORS 58 WARNINGS` — PASS (all 58 warnings are pre-existing, none introduced by this task)

---

## Panels converted

| id | title | notes |
|----|-------|-------|
| `app-email-ingestion` | "Email ingestion status" | Required modifying `EmailPollerPanel.svelte` (see below) |
| `app-metadata-queue` | "Song metadata queue" | StatusChip moved to top of body |
| `app-rating-weights` | "Rating weights" | StatusChip (ACTIVE) moved to top of body |
| `app-rating-weights-legacy` | "Rating weights (legacy)" | Special handling — see below |
| `app-zip-import` | "ZIP import & rescan" | Conditional StatusChip moved to top of body |
| `app-debug-mode` | "Debug mode" | Conditional StatusChip moved to top of body |

---

## Script block

The `<script>` in `+page.svelte` was touched in two places only:
1. Added `import CollapsiblePanel from '$lib/components/CollapsiblePanel.svelte';`
2. Removed `import SectionLabel from '$lib/components/SectionLabel.svelte';` — this import became unused once all panel headers (which contained `<SectionLabel>`) were removed. Leaving an unused import would trigger a warning.

No reactive state, event handlers, bindings, or logic was touched.

---

## EmailPollerPanel special handling

The email ingestion panel lives in `ui/src/lib/email/EmailPollerPanel.svelte` as its own component with its own `<section>` wrapper and `<header>`. To avoid double-wrapping (CollapsiblePanel's `<section>` containing another `<section>`), the component was modified:

- Removed the outer `<section>` wrapper (open/close tags)
- Removed the `<header>` block (which held `<SectionLabel>`, `<h2>Email ingestion</h2>`, and the refresh `<button>`)
- Moved the refresh button to the top of the component body (before the status indicator) as a standalone `<div class="flex justify-end mb-3">` wrapper
- Removed the now-unused `import SectionLabel` from EmailPollerPanel's script

The refresh button's `onclick={refresh}`, `disabled={refreshing}`, and all styling were preserved verbatim. Only its container moved from the header into the body.

---

## Legacy weights panel — special styling

The original panel had `class="... border border-dashed border-border-muted ... opacity-60"`. The `CollapsiblePanel` component renders its own `<section>` with a solid border and does not accept a `class` prop, so the dashed border cannot be applied to the outer shell without modifying the component (which was out of scope).

Preservation approach:
- Used `subtitle="Deprecated — frozen"` prop to surface the frozen/legacy status in the CollapsiblePanel header
- Wrapped the slot body in `<div class="opacity-60">` to preserve the dim/muted visual cue
- The `StatusChip label="DEPRECATED" tone="muted"` is shown at the top of the body

The dashed border is lost (converted to the standard solid border of CollapsiblePanel). The deprecated state is still clearly communicated via subtitle text, opacity, and the DEPRECATED status chip.

---

## Files modified

- `ui/src/routes/settings/+page.svelte` — import added, 6 panels converted
- `ui/src/lib/email/EmailPollerPanel.svelte` — section wrapper and header removed, refresh button relocated to body

---

# Task 6 Report — Honest prep-checks: Tastemaker coverage + Chat row

## Status: DONE

---

## 1. Tastemaker Coverage SQL

Old check used a round-scoped INNER JOIN (row existence only):

```sql
SELECT COUNT(*) AS n FROM ml_submissions s
JOIN song_popularity p ON p.spotify_uri = s.spotify_uri
WHERE s.round_id = ?
```

Replaced with a **cumulative-season LEFT JOIN** counting `popularity_proxy IS NOT NULL`, matching the `getDiscoverability` gate exactly:

```sql
SELECT COUNT(*) AS total,
       SUM(CASE WHEN sp.popularity_proxy IS NOT NULL THEN 1 ELSE 0 END) AS covered
FROM ml_submissions s
JOIN rounds r ON r.id = s.round_id
LEFT JOIN song_popularity sp ON sp.spotify_uri = s.spotify_uri
WHERE r.season_id = (SELECT season_id FROM rounds WHERE id = ?)
  AND r.id <= ?
```

- `total` = all season submissions through the target round (cumulative)
- `covered` = those with a non-null `popularity_proxy`
- threshold: `covRatio >= 0.8` (matches discoverability gate)
- Row: `{ ok: tastemakerOk, src: 'song_popularity · <covered>/<total> proxied', count: cov.covered, optional: true }`

---

## 2. League Slug Resolution

`runPrepChecks` does not resolve a league slug explicitly. The Chat row delegates entirely to `roundChatWindow(db, roundId)` which already performs the `rounds → seasons → leagues` join and returns `{ groupName, fromIso, toIso }`. No duplicate league lookup was added.

---

## 3. Chat Row — roundChatWindow reused

```ts
const chatWin = roundChatWindow(db, roundId);
const chatCount = chatWin.groupName
  ? getRoundMessages(db, chatWin.groupName, chatWin.fromIso, chatWin.toIso).length
  : 0;
```

Imported from `'../chat/historyQuery.js'` (relative, same pattern as `llm.ts`). Window formula is byte-identical to the round page — zero duplication.

Returned row placed immediately after `'Chat-window mentions'`. Also added to the early-return (no round found) path with `ok: false, src: 'chat_messages · league unmapped'`.

---

## 4. Test Results

```
Test Files  1 passed (1)
Tests       6 passed (6)
```

Tests (TDD — confirmed 6 fail before implementation, 6 pass after):

- Tastemaker 7/10 proxied → ok=false, count=7, src='song_popularity · 7/10 proxied'
- Tastemaker 8/10 proxied → ok=true, count=8, src='song_popularity · 8/10 proxied'
- Cumulative scope: r1=5 proxied + r2=5 unproxied → 5/10, ok=false when checking r2
- Chat: mapped league + 3 in-window messages → ok=true, count=3, src='chat_messages · TestGroup'
- Chat: unmapped league → ok=false, count=0, src='chat_messages · league unmapped'
- Chat: mapped but no messages → ok=false, count=0, src='chat_messages · TestGroup'

---

## 5. npm run check

```
COMPLETED 1017 FILES   0 ERRORS   58 WARNINGS
```

0 type errors. All 58 warnings are pre-existing.

---

## 6. Scope Compliance

- Only `prepChecks.ts` and `prepChecks.test.ts` were modified/created.
- `roundChatWindow` reused as-is — not reimplemented.
- `discoverability.ts` and UI were not touched.
- Committed in-place on `master` (main checkout), no worktree.

---

## 7. Deviations

None.
