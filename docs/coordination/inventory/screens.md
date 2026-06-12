# Screen & Feature Inventory — sprint-26

> **How this was produced:** Hands-on walkthrough of every route in `ui/src/routes`
> against a live `npm run dev` instance (port 5180) on the real prod DB
> (`data/league.db`). Source verified via component code where actions were
> obvious; API endpoint calls confirmed against source (no mutations were made
> during the screen-inventory walk). 2026-06-12.

---

## Routes inventoried

| Route | Component | Section |
|---|---|---|
| `/` | `+page.svelte` | [Home](#route--) |
| `/setup` | `+page.svelte` | [Setup](#route-setup) |
| `/digest/[roundId]` | `+page.svelte` | [Digest](#route-digestroundid) |
| `/shortlist` | `+page.svelte` | [Shortlist](#route-shortlist) |
| `/history` | `+page.svelte` | [History](#route-history) |
| `/chat` | `+page.svelte` | [Chat](#route-chat) |
| `/settings` | `+page.svelte` | [Settings](#route-settings) |
| `/settings/api-tokens` | `+page.svelte` | [API Tokens](#route-settingsapi-tokens) |
| `/league/[league]/season/[n]` | `+page.svelte` | [Season](#route-leagueleagueseasonn) |
| `/league/[league]/season/[n]/round/[roundId]` | `+page.svelte` | [Round](#route-leagueleagueasonnroundroundid) |
| `/_examples` | `+page.svelte` | Dev-only UI showcase — excluded from inventory |

---

## Route: `/`

**Purpose:** Dashboard overview. Shows leagues that need attention this week
(active submission/voting rounds) and all adopted leagues in a grid.

### Actions

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Toggle league active/inactive | "Active/Inactive" button per league card in All Leagues grid | `PATCH /api/leagues/:leagueId/active` | `leagues.is_active` (manuallyActive flag) | Same endpoint as `/setup` league toggle |

### Data loaded (read)
- Active seasons with current round + phase + deadlines
- Past leagues with total round counts
- League active states (`manuallyActive` flag)
- `ActiveRounds` component: `GET /api/active-rounds` (loaded separately on mount)

### Notes
- The `ActiveRounds` component also has a "set active round" modal (PUT `/api/leagues/:id/active-round`) — see the home page's embedded `<ActiveRounds>` usage. This appears on every page that renders the home layout.

---

## Route: `/setup`

**Purpose:** Administrative management of all core data — leagues, seasons, active
rounds, round metadata (number/name/tag/submitter), players, identities,
relationships, and season memberships.

### Actions

#### Leagues & Seasons subsection

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Toggle league active | "Activate / Deactivate" button | `PATCH /api/leagues/:leagueId/active` | `leagues.is_active` | Also on home `/` |
| Set active round | `<select>` dropdown per league | `PUT /api/leagues/:leagueId/active-round` | `leagues.active_round_id` | Also in `ActiveRounds` modal on home |
| Flip season status | "Mark complete / Reactivate" button | `PATCH /api/leagues/:leagueId/seasons/:seasonId` | `seasons.status` | **COLLISION:** importer also writes `seasons.status` via heuristic re-derivation (sprint-25 finding 1) |

#### Rounds subsection

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Edit round number | Inline number `<input>` (onblur) | `PATCH /api/rounds/:roundId` | `rounds.round_number` | No other surface writes round_number |
| Edit round name | Inline text `<input>` (onblur) | `PATCH /api/rounds/:roundId` | `rounds.name` | **OVERLAP:** also editable in `/league/.../round/[id]` edit modal |
| Edit round tag | Inline text `<input>` (onblur) | `PATCH /api/rounds/:roundId` | `rounds.tag` | No other surface |
| Edit theme submitter | `<select>` (onchange) | `PATCH /api/rounds/:roundId` | `rounds.theme_submitted_by` | No other surface |
| Add round | "+ Add round" button | `POST /api/leagues/:leagueId/rounds` | `rounds` INSERT; optionally sets `leagues.active_round_id` | No other surface creates rounds via UI |

#### Players subsection

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Add player | "Add player" button | `POST /api/players` | `players` INSERT | No other surface |
| Edit player name/age | Name/age inputs (onblur) | `PATCH /api/players/:playerId` | `players.name`, `players.age` | No other surface |
| Toggle season membership | Season chip per player | `POST /api/seasons/:seasonId/players` or `DELETE /api/seasons/:seasonId/players/:playerId` | `season_players` | No other surface |
| Add identity | "+ Add identity" flow | `POST /api/players/:playerId/identities` | `player_identities` | No other surface |
| Delete identity | "✕" per identity row | `DELETE /api/players/:playerId/identities/:identityId` | `player_identities` | No other surface |
| Add relationship | Relationship form | `POST /api/players/:playerId/relationships` | `player_relationships` | No other surface |
| Delete relationship | "✕" per relationship | `DELETE /api/players/:playerId/relationships/:relId` | `player_relationships` | No other surface |

### Desktop (md+) vs mobile (412×892)
- Rounds subsection: desktop shows a full table; mobile collapses to cards with
  the same input fields. Both call the same endpoints.
- Players: same layout both sizes; identities and relationship subforms stack
  vertically on mobile.

---

## Route: `/digest/[roundId]`

**Purpose:** Full digest production pipeline — prepare data, generate AI draft,
refine/lock sections, finalize and export/publish.

### Actions

#### Prepare stage

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Re-run checks | "Re-run checks" button | `POST /api/digest/:roundId/prepare` | `digest_drafts` (prep data) | — |
| Import from CLI | "Import from CLI" button (visible when checks fail) | `POST /api/digest/:roundId/import-export-zip` | `ml_submissions`, `votes`, `rounds.*`, `seasons.status` via importer pipeline | **COLLISION:** importer re-derives `seasons.status` (sprint-25 finding 1); may clobber manual flip |

#### Draft/Refine stage

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Generate draft | "Generate draft…" button → `GenerateModal` | `POST /api/digest/:roundId/draft` | `digest_drafts`, `digest_sections` | — |
| Regenerate whole draft | "↻ Regenerate whole draft" | `POST /api/digest/:roundId/regenerate` | `digest_sections` (all unlocked) | — |
| Regenerate single section | Regen button per section → `RegenModal` | `POST /api/digest/:roundId/sections/:id/regenerate` | `digest_sections` (one row) | — |
| Toggle section excluded | "⊘" button per section | local state + `PATCH /api/digest/:roundId/sections/:id` | `digest_sections.state` | — |
| Toggle section locked | lock button per section | local state + `PATCH /api/digest/:roundId/sections/:id` | `digest_sections.state` | — |
| Change section variant | variant switcher | `PATCH /api/digest/:roundId/sections/:id` | `digest_sections.variant` | — |
| Inline edit section | "✎ edit" on standings | `PATCH /api/digest/:roundId/sections/:id` | `digest_sections.content_json` | — |
| Adopt standings | "Recompute" in GenerateModal | `POST /api/digest/:roundId/standings { action:'adopt' }` | `digest_drafts` standings gospel | — |
| Edit figures (standings) | "✎ edit figures" → `EditableStandingsTable` | `POST /api/digest/:roundId/standings` | `digest_drafts` standings | — |
| Edit next-round (exclude) | "⊘" button in NextRoundSection | `PATCH /api/digest/:roundId/next-round { excluded }` | `digest_drafts.next_round_excluded` | **OVERLAP:** `nextRoundExcluded` also set from GenerateModal params (fire-and-forget PATCH) |
| Edit next-round (theme/deadlines) | "✎ Edit theme + deadlines" kebab | `PATCH /api/digest/:roundId/next-round { themeOverride, submissionDeadlineOverride, votingDeadlineOverride }` | `digest_drafts.next_round_*_override` | **OVERLAP:** These overrides shadow `rounds.submission_deadline` / `rounds.voting_deadline` set via /setup or /settings. If deadlines are updated in `/setup`/`/settings` AFTER an override is set, the override continues to win in the digest display. |
| Reset next-round to computed | "↺ Reset to computed" kebab | `PATCH /api/digest/:roundId/next-round { themeOverride:null, submissionDeadlineOverride:null, votingDeadlineOverride:null }` | clears `digest_drafts.next_round_*_override` | — |

#### Finalize / Export stage

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Finalize & export (pdf/png/wide/sections) | "↓ Finalize & export" button | `POST /api/digest/:roundId/finalize { format }` | `digest_drafts.finalized_at`, `relationship_contexts` | — |
| Export only (re-export finalized) | "↓ Export" button | `POST /api/digest/:roundId/export { format }` | (no DB write — renders and downloads) | — |
| Publish share link | "🔗 Publish share link" (html format) | `POST /api/digest/:roundId/export { format:'html' }` | `digest_shares` | — |
| Unfinalize | "↩ Unfinalize" button | `POST /api/digest/:roundId/unfinalize` | clears `digest_drafts.finalized_at` | — |

### Round picker
- `<select>` on page navigates to `/digest/:roundId` via `goto()` — no API write.

### Desktop vs mobile (412×892)
- Pipeline pill bar, section list, standings chart, export format toggle all
  visible at both widths. At mobile, the export format toggle wraps below the
  action buttons. The `.dg-export` frame gets `dg-export--mobile` reflow class
  when `?format=mobile` is in the URL.

---

## Route: `/shortlist`

**Purpose:** Song research queue. Add, rate, assign, and track candidate songs
for upcoming rounds.

### Actions

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Add song | SearchBar → spotify search result → add | `POST /api/shortlist` | `shortlist_songs` INSERT | — |
| Remove song | "Delete" in `ShortlistRow` | `DELETE /api/shortlist/:id` | `shortlist_songs` soft/hard delete | — |
| Rate song | Star/dot rating controls in `ShortlistRow` | `PATCH /api/shortlist/:id/rating` | `shortlist_songs.rating_*` columns | — |
| Add notes | Notes area in `ShortlistRow` | `PATCH /api/shortlist/:id/notes` | `shortlist_songs.notes` | — |
| Mark submitted-elsewhere | toggle in `ShortlistRow` | `PATCH /api/shortlist/:id/submitted-elsewhere` | `shortlist_songs.submitted_elsewhere` | — |
| Assign to round (quick-assign strip) | "Assign" in `ShortlistStrip` | `POST /api/shortlist/:id/assign` | `shortlist_assignments` INSERT | — |
| Assign to round (row) | Assign button in open `ShortlistRow` | `POST /api/shortlist/:id/assign` | `shortlist_assignments` INSERT | Same endpoint, different trigger |
| Unassign from round | Unassign button in open `ShortlistRow` | `DELETE /api/shortlist/:id/assign/:roundId` | `shortlist_assignments` DELETE | — |
| Start H2H | "H2H" button per league row in `ShortlistStrip` | (no API — opens `ShortlistH2HPanel` locally) | none until winner assigned | — |
| Assign H2H winner | Champion pick in `ShortlistH2HPanel` | `POST /api/shortlist/:id/assign` | `shortlist_assignments` INSERT | Same endpoint as quick-assign |

### Sort
- Sort pills (date added / score / personal) sort `songs` array client-side — no API call.

### Keyboard shortcuts
- `/` → focus search; `Esc` → close; `r` + `1–5` → personal rating for open row; `?` → help overlay. No API calls.

### Desktop vs mobile (412×892)
- `ShortlistStrip` (quick-assign header) is sticky at top.
- Song rows and search bar stack vertically. At mobile, the strip collapses to a
  single-league row view; the H2H panel renders full-width below.

---

## Route: `/history`

**Purpose:** Research corpus — search songs by history, explore themes, view
per-player stats.

### Tabs

| Tab | Component | Actions | Endpoints |
|---|---|---|---|
| Song search | `SongSearchTab` | Spotify search, flag by history | `GET /api/spotify/search`, `GET /api/history/song-status` (read-only) |
| Theme research | `ThemeResearchTab` | Seed theme, find related | `GET /api/history/themes` (read-only) |
| Player research | `PlayerResearchTab` | Browse player roster, drill into individual | `GET /api/history/players`, `GET /api/history/players/:name` (read-only) |

**No writes** originate from the history page. Tab selection changes the URL
(`?tab=songs|themes|players`) via `goto()`.

### Desktop vs mobile (412×892)
- Tab strip is scrollable on mobile. Panel content stacks vertically.

---

## Route: `/chat`

**Purpose:** Songs shared in WhatsApp/Google Chat. Rate, assign to shortlist, or
assign to a round from the chat context.

### Actions

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Filter by status | Status dropdown in `CwFilterBar` | URL param only (`?status=`) | — | — |
| Filter by chat name | Chat name dropdown | URL param only (`?chat=`) | — | — |
| Sort | Sort dropdown | URL param only (`?sort=`) | — | — |
| Rate/assign/shortlist song | Controls in open `CwRow` | `PATCH /api/chat/songs/:id` (rating/status), `POST /api/chat/songs/:id/assign/:roundId`, `POST /api/chat/songs/:id/shortlist` | `chat_songs.*`, `chat_assignments` | shortlist action adds to `shortlist_songs` — separate from `/shortlist`'s own queue |
| Dismiss song | Dismiss in `CwRow` | `POST /api/chat/songs/:id/dismiss` | `chat_songs.status = 'dismissed'` | — |

### Desktop vs mobile (412×892)
- Filter bar wraps on mobile. Song rows are full-width at all sizes.

---

## Route: `/settings`

**Purpose:** Rating weights, ZIP import, re-scan, queue status, deadline
management.

### Actions

#### Rating weights

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Save weights | "Save weights" form submit | SvelteKit form action `?/updateWeights` | `settings` table (key-value) | No other surface |
| Reset weights | "Reset defaults" button | client-only state reset | none until "Save weights" | — |

#### ZIP import / rescan

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Import ZIP | "Import" form submit | SvelteKit form action `?/importZip` | `rounds`, `ml_submissions`, `votes`, `seasons.status` (via importer) | **COLLISION:** importer re-derives `seasons.status` — same collision as digest CLI import |
| Re-scan disk | "Re-scan disk" form submit | SvelteKit form action `?/rescan` | same as importZip | Same collision |

#### Deadlines

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Save deadline (single round) | "Save" per round row in deadlines list | SvelteKit form action `?/updateDeadline` | `rounds.submission_deadline`, `rounds.voting_deadline` | **OVERLAP:** same fields written from `/league/.../round/:id` edit modal and auto-fill |
| Auto-fill deadlines (bulk) | "Auto-fill deadlines" button | `POST /api/deadlines/auto-fill` | `rounds.submission_deadline`, `rounds.voting_deadline` (for all rounds in season) | **OVERLAP:** same fields; auto-fill is bulk so can clobber manually-set deadlines from other surfaces |

#### Queue diagnostics

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Retry songlink | "Retry" per failed row | SvelteKit form action `?/retryYtm` | `ytm_resolution_queue` | No other surface |

### Desktop vs mobile (412×892)
- Two-column layout (weights left, import + queue + auto-fill right) collapses to
  single column on mobile.
- Round deadlines list is in a `<details>` block (collapsed by default).

---

## Route: `/settings/api-tokens`

**Purpose:** Manage bearer tokens for the browser extension and API clients.

### Actions

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Generate new token | "+ Generate new token" → `TokenGenerateModal` | `POST /api/tokens` | `api_tokens` INSERT | No other surface |
| Revoke token | "Revoke" per row (with confirm dialog) | `DELETE /api/tokens/:id` | `api_tokens.revoked_at` | No other surface |

### Desktop vs mobile (412×892)
- Token table is scrollable. Modal renders full-screen on mobile.

---

## Route: `/league/[league]/season/[n]`

**Purpose:** Season overview — shows active and archived rounds as navigation cards.

### Actions

No writes. All content is read-only navigation links to `/league/.../round/:id`.

### Desktop vs mobile (412×892)
- Round cards render in a responsive grid (1 → 2 → 3 columns). At 412px, cards are single-column full-width.

---

## Route: `/league/[league]/season/[n]/round/[roundId]`

**Purpose:** Round detail view — ML playlist (submissions + voting dots), chat
mentions, song research, H2H shortlist tournament. Includes an "Edit round"
modal for round metadata.

### Tabs

| Tab | Purpose | Actions |
|---|---|---|
| ML Playlist | Submissions with vote dots, Spotify/YTM links | Rate songs (research upsert) |
| Chat Mentions | Chat-sourced songs for this round's window | Read-only |
| Research | Song research candidates | Full CRUD via `ResearchList` |
| Head-to-Head | King-of-the-hill tournament over research candidates | Pick winner, reset |

### Actions

| Action | Trigger | Endpoint | Fields written | Overlap |
|---|---|---|---|---|
| Edit round | "✎" pencil header button → modal | `PATCH /api/rounds/:roundId` | `rounds.name`, `rounds.description` (theme), `rounds.submission_deadline`, `rounds.voting_deadline`, `rounds.spotify_playlist_url` | **OVERLAP (name):** also editable in `/setup` rounds table. **OVERLAP (deadlines):** also writable from `/settings` deadline form and auto-fill. **OVERLAP (theme/description):** the digest next-round override (`digest_drafts.next_round_theme_override`) shadows this for digest display. |
| Rate ML song | "▸ Rate" → dot rating → "Save" | `POST /api/research/:roundId` then `PATCH /api/research/:roundId` | `research_songs` upsert | — |
| Add research | "Add" in `ResearchList` | `POST /api/research/:roundId` | `research_songs` INSERT | — |
| Edit/delete research | Controls in `ResearchList` | `PATCH /api/research/:roundId` / `DELETE /api/research/:id` | `research_songs` | — |
| H2H pick winner | Card pick | `POST /api/h2h/match` | `head_to_head_matches` | — |
| H2H reset | "Reset and pick again" | `DELETE /api/h2h/state/:roundId` | clears `head_to_head_matches` for round | — |
| Switch Spotify/YTM | Toggle pill | client state only | none | — |

### Desktop vs mobile (412×892)
- Tab strip is horizontal at all sizes; at 412px it scrolls if tabs overflow.
- Edit round modal: two-column deadline grid collapses to single column on mobile.
- ML playlist: song rows are full-width single column at mobile. Rating editor
  stacks below the row.
- H2H: two candidate cards are `flex-col` on mobile (stacked), `flex-row` on md+.

---

## Cross-screen overlap summary

### Round name
- Writable from: `/setup` (inline table, saves on blur) · `/league/.../round/:id` edit modal

### Round deadlines (`submission_deadline`, `voting_deadline`)
- Writable from: `/settings` deadline form per round · `/settings` auto-fill (bulk) · `/league/.../round/:id` edit modal
- **Shadowed by** (digest only): `/digest/[roundId]` next-round override (`digest_drafts.next_round_sub_deadline_override`, `next_round_vote_deadline_override`) — these override the `rounds` values for the digest's "Next Round Up" display only.

### Season status
- Writable from: `/setup` "Mark complete / Reactivate" button (`PATCH /api/leagues/:id/seasons/:sid`) · `/settings` ZIP import and rescan (importer heuristic) · `/digest/:id` CLI import (same importer)
- **Known live bug:** no `status_source` override column — importer can re-derive and clobber a manual flip (sprint-25 finding 1).

### League active flag
- Writable from: `/` home All Leagues toggle · `/setup` league header toggle
- Both call the same endpoint (`PATCH /api/leagues/:id/active`); no collision.

### Active round pin
- Writable from: `/setup` active-round dropdown · `ActiveRounds` modal (embedded in home `/`)
- Both call the same endpoint (`PUT /api/leagues/:id/active-round`); no collision.
