# Portal admin controls — b-side content scheduling, This-week cards, season planner — design spec

**Date:** 2026-10-08 · **Status:** design written 2026-10-08 (Matt); plan pending.
**Program:** b-side is the ONLY player page. 1 shell → 2 live stats → 3 survey in portal → **4 per-league portal admin (Access path)** → 5 research → 6 song rating. This is piece 4, part A.
**Owner:** music-league-bot session. No survey-app changes required (§3).

---

## 1. Goal

An admin, signed in on the league's own portal (`digest.mattmariani.com/<slug>/admin`), can:

1. **Choose which b-side sections appear** on the league's Home, **when they update and how often**, and in some cases **edit the prompt / content directly**.
2. **Configure the "This week" cards** — including a real **current-round card** (round name, current phase, playlist links, Music League link) and **open theme surveys** at the top.
3. **Pick which KPIs** appear under *By the numbers* (all currently available selected by default; the list is data-driven so future KPIs show up automatically).
4. **Pick which players** appear in *The family* (per-player pill toggles).
5. **Pick which season** *Yearbook awards* runs against.
6. See a **season task planner**: the whole season laid out — every content bit that must be produced and when — plus a **next-7-days day planner** that is the first thing an admin sees.

**Out of scope this pass:** automatic execution of the schedule (a timer that fires the runs). This pass ships the config, the derivation, the UI, and a **Run now** button. `§8` records the follow-up.

---

## 2. Decisions

| Question | Decision | Why |
|---|---|---|
| How does the portal reach bot-ui's b-side update machinery? | **Cloudflare Access path app + JWT verification** (piece 4 as already scoped). One new, narrow, recorded Caddy prefix `/api/portal-admin/*` → bot-ui. | Zero Trust already protects `mlb13`; no new auth system; **the survey app stays untouched** (no cross-repo dependency); bot-ui verifies the Access JWT itself so the boundary lives with the service being protected. |
| Where does admin config live? | bot-ui SQLite (`settings` key per league, plus a tasks table). | bot-ui owns rounds, deadlines, phases, playlists, KPIs, members — everything the planner and section config derive from. |
| What reaches the public bundle? | Only a **public-safe display subset** in `portal.json` (`sections`). Prompts, schedules, run history, task status stay server-side. | Matches the existing leak rules. |
| Is Settings/Profile/Admin consolidated? | **No change.** Settings and Profile are one route today; keep them. Admin gains tabs. | Per Matt 2026-10-08. |
| What happens to *Fresh off the press*? | **Removed** from Home. It repeats the *Latest digest* card in *This week*. Its "All digests →" archive link moves into the *This week* footer. | Per Matt 2026-10-08. Survey `news` endpoints stay server-side; the portal simply stops rendering them (the `Post to Home` admin card moves to the B-side tab, keeping the capability without a third section). |
| What executes the schedule? | Nothing, this pass. `frequency` is stored, validated, and displayed with *last run* / *next due (pending automation)*. **Run now** executes immediately. | Matt 2026-10-08: "Config + manual Run now". |

### 2.1 Rejected alternatives (recorded so they aren't re-litigated)

- **Survey app as gateway → bot-ui.** No Caddy change, but it puts the security boundary in the *other* repo and turns the survey app into a confused deputy forwarding to the admin app. Cross-repo, two sessions, slowest.
- **Shared JSON files in the survey data dir.** bot-ui's mount is read-only, so run status could not round-trip; "Run now" would be a ≤5 min poll. Rejected.
- **Broadening the digest host to `/api/*`.** Forbidden outright — see the `Caddyfile.digest` header comment.

---

## 3. Transport & auth

### 3.1 Network path

```
browser (admin, same-origin fetch, CF_Authorization cookie)
  → cloudflared → digest-static Caddy (:8080)
      handle /api/portal-admin/*   ← NEW, recorded exception
        GET|POST|PUT only, body ≤ 64 KB
        reverse_proxy bot-ui:3002
  → bot-ui verifies Cf-Access-Jwt-Assertion → handler
```

### 3.2 Caddy (new block, immediately after `/api/survey/*`)

```
@portalAdminNotMethod not method GET POST PUT
handle /api/portal-admin/* {
    header X-Robots-Tag "noindex, nofollow"
    header Cache-Control "no-store"
    route {
        respond @portalAdminNotMethod 405
        request_body { max_size 64KB }
        reverse_proxy bot-ui:3002
    }
}
```

Plus a comment block stating: this is the **second** deliberate exception to the `/api/p/*`-only rule, it is gated by a Cloudflare Access application on the exact path `digest.mattmariani.com/api/portal-admin*` and by JWT verification inside bot-ui, and **no other bot-ui path may ever be added to this host**.

### 3.3 Cloudflare Access

- Self-hosted application, domain `digest.mattmariani.com/api/portal-admin*`, policy = Access group of league admins (Matt + co-admins). Everything else on the hostname stays public.
- Access sets `CF_Authorization` (cookie, same host → sent automatically by the SPA's `credentials: 'same-origin'` fetches) and `Cf-Access-Jwt-Assertion` (header, per request).

### 3.4 bot-ui verification (defense in depth)

`ui/src/lib/portalAdmin/auth.ts`:

- `verifyPortalAdmin(req)`:
  1. `CF_ACCESS_TEAM_DOMAIN` must be set; otherwise **fail closed** (401).
  2. Read `Cf-Access-Jwt-Assertion`, verify RS256 against `https://<team>/.well-known/jwks.json`, cache JWKS with `kid` lookup and a 5 min TTL (a failed `kid` forces one refresh).
  3. Check `iss`, `exp` (≤ 5 min clock skew), and `aud` (the Access application audience when present).
  4. Require `email` ∈ `PORTAL_ADMIN_EMAILS` (comma-separated env) — the same set the Access policy uses. Fail closed when the env var is empty.
- Every `/api/portal-admin/*` route calls it first. **No JWT → 401, before any body is read.**
- The router is mounted on its own path prefix and has an explicit route table; anything unmatched under the prefix is a 404. It must never fall through to SvelteKit page routes.
- The routes are read-mostly. The only WhatsApp-adjacent behaviour they may trigger is the existing b-side **update** pipeline (which publishes a static site and writes a share card), never a direct message send.

**Why not header-trust only:** `bot-ui:3002` is published on the host. A request that reaches it directly could spoof `Cf-Access-Authenticated-User-Email`. Signature verification makes origin-bypass useless.

---

## 4. Admin screen (portal `/admin`)

`AdminScreen.svelte` becomes a tabbed screen. Visibility of the two new tabs is gated on the existing `session.api.adminSession()` → `admin: true` (the survey app already knows who the co-admins are; that gate is unchanged).

| Tab | Contents | Source |
|---|---|---|
| **Access** | OTP send / verify / code box, switch requests, co-admin roles | existing, unchanged |
| **B-side** | Section list (§5), current-round card config, KPI picker, family player picker, prompts, **Run now**, *Post to Home* (moved here from Access) | new |
| **Season planner** | Next-7-days day view + full-season layout (§7) | new |

All new calls go to `/api/portal-admin/<leagueSlug>/…`.

---

## 5. B-side sections

### 5.1 Inventory

| id | Section (Home eyebrow) | Include toggle | Schedule | Editable content | Public display config |
|---|---|---|---|---|---|
| `thisWeek` | **This week** | ✔ | `on-event` \| `hourly` \| `daily` \| `weekly` \| `manual` | card set + which playlist links (§6) | `cards`, `links` |
| `byNumbers` | **By the numbers / The season so far** | ✔ | same | **KPI multi-select** (§5.3) | `kpis` |
| `pulse` | **The pulse** | ✔ | same | **system prompt** (textarea, *Reset to default*) | — |
| `yearbook` | **Yearbook awards** | ✔ | same | **season selector** | — |
| `family` | **The family** | ✔ | same | **per-player pills** (§5.4) | `players` |
| `moments` | **Moments of the season · Consensus, not ranking** | ✔ | same | system prompt (textarea, reset) | — |
| ~~`press`~~ | ~~Fresh off the press~~ | — | — | — | **removed** (§2) |

`on-event` = refresh only when something changes that feeds it (round finalised, survey opened/closed, member added). That is today's behaviour and the default everywhere.

### 5.2 Config shape (bot-ui, `settings` key `portal_admin_config:<leagueId>`)

```jsonc
{
  "version": 1,
  "sections": {
    "thisWeek":  { "enabled": true,  "frequency": "on-event",
                   "cards": { "latestDigest": true, "currentRound": true,
                              "openPolls": true, "themeSurvey": true },
                   "links": { "spotify": true, "ytm": true, "youtube": true, "musicLeague": true } },
    "byNumbers": { "enabled": true,  "frequency": "daily",
                   "kpis": ["songs", "points", "winners", "noteWords"] },
    "pulse":     { "enabled": true,  "frequency": "weekly", "prompt": null },
    "yearbook":  { "enabled": true,  "frequency": "on-event", "season": null },
    "family":    { "enabled": true,  "frequency": "weekly",
                   "players": { "<memberId>": true } },
    "moments":   { "enabled": true,  "frequency": "on-event", "prompt": null }
  },
  "runState": { "<sectionId>": { "lastRunAt": "…", "lastStatus": "ok|error", "lastError": null } }
}
```

- `prompt: null` = built-in default. A string overrides it. `Reset to default` writes `null`.
- `season: null` = current season; a number pins it.
- `players` absent/`{}` = everyone (back-compatible). Explicit `false` values exclude.
- `kpis` defaults to **every currently available KPI id** at first save — exactly what the picker shows pre-filled.
- `frequency` is recorded only this pass (§2).

### 5.3 KPI ids (new, stable)

`buildKpis` gains a stable `id` next to `label`/`value`/`sub`:

| id | today's label |
|---|---|
| `songs` | songs submitted |
| `points` | points awarded |
| `winners` | different round winners |
| `noteWords` | avg words per submission note |

`KpiItemSchema` gains optional `id: z.string().optional()` so existing read models keep validating. HomeScreen filters `readModel.kpis` by the selected ids **when `portal.sections.byNumbers.kpis` is present**, otherwise renders all — so a stale `portal.json` shows everything rather than nothing.

Adding a KPI later is: give it an id, and it appears in the picker automatically (the picker reads a **catalog** endpoint, not the current selection).

### 5.4 The family picker

Pills, one per `readModel.members` entry (avatar + name + initials), toggle include/exclude, with **All / None** shortcuts and a live count ("18 of 21 shown"). Saved as `players`. Excluded players are filtered out of the grid on Home; their **profile routes stay reachable** (the URL is guessable from a shared link and hiding the grid is presentation, not access control — no privacy claim is made).

### 5.5 Run now

`POST /api/portal-admin/<slug>/run { sectionIds: string[] }` → 202 `{ jobId }`, then poll `GET …/run/<jobId>`.

- Reuses the existing update pipeline (`ui/src/routes/api/content/[leagueId]/update/+server.ts`) for the sections that regenerate read-model slices; `thisWeek`/`family` display toggles only need a `portal.json` rewrite, which the same job already performs.
- Response records `lastRunAt` / `lastStatus` into `runState`.
- Button state: *Run now* → *Running…* → *Updated 14:32* / *Failed: …*.

---

## 6. "This week" cards

### 6.1 Cards

| Card | Shown when | Behaviour |
|---|---|---|
| **Latest digest** | a digest URL exists | link to `/d2/…` (unchanged) |
| **Current round** (§6.2) | a round is in flight | opens Season |
| **Open poll** (one per poll) | `feed.pollsOpen.length > 0` | opens Season (unchanged) |
| **Open theme survey** | `feed.surveyOpen` (or `portal.survey` present and the survey is open) | `/{slug}/survey` |
| *Post to Home* news | when an admin has published one | static card (unchanged) |

**Open theme surveys at the top** is new: it links the league's theme survey form alongside the existing open polls, so an admin can see from Home whether the survey is live.

### 6.2 Current-round card (new data)

Today's "Up next" card shows a round name and a due date. It becomes **Current round**:

```
CURRENT ROUND
Round 4 — "Songs that make you drive faster"
phase pill:  SUBMISSION  |  VOTING
deadline line
[ Spotify ] [ YouTube Music ] [ YouTube video ] [ Music League ]   ← only those that exist
```

**Name + phase are derived client-side from the season feed** (already fetched, already fresh, already leak-safe):

- in-flight round = first `lineup` entry where `now < votesDue` (voting) or `now < songsDue` (submission);
- `phase = now < songsDue ? 'submission' : 'voting'`;
- if the feed is unavailable, fall back to `upNext()` and show no phase pill.

**Links come from `portal.json`** (they cannot be derived client-side):

```ts
export interface PortalRoundLinks { n: number; spotify: string | null; ytm: string | null; youtube: string | null; musicLeague: string | null; }
// PortalJson gains:
roundLinks: PortalRoundLinks[];
```

Sources in bot-ui:

| link | source |
|---|---|
| Spotify | `rounds.spotify_playlist_url` |
| YouTube Music | `ytm_drops.ytm_url` (written by `scripts/ytm-drop`) |
| YouTube video | ytm video review `videoUrl` (`markPlaylistBuilt`, `rounds`-keyed) |
| Music League | `https://app.musicleague.com/l/{seasons.source_competition_id}/{rounds.ml_round_id}/` |

**Leak rules for `roundLinks`:** emit **only the URLs and the round number — never a theme, name, or credit.** A playlist URL only exists once a round's submission phase has opened (i.e. the round is already revealed), and round numbers are already visible as teaser cards, so no hidden-round information can surface. `writePortalJson` runs the existing `findLeaks` check over the new field as it does for everything else. A `null` URL means "does not exist" and the card omits that button.

---

## 7. Season planner

### 7.1 Model

New table (idempotent `CREATE TABLE IF NOT EXISTS` in `ui/src/lib/db/client.ts`):

```sql
CREATE TABLE IF NOT EXISTS portal_admin_tasks (
  id INTEGER PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_number INTEGER NOT NULL,
  key TEXT NOT NULL,              -- stable, e.g. 'r3.capture-spotify'
  round_number INTEGER,           -- NULL for season-level milestones
  title TEXT NOT NULL,
  detail TEXT,
  due_at TEXT,                    -- ISO; NULL = unscheduled
  kind TEXT NOT NULL CHECK(kind IN ('content','ops','review')),
  source TEXT NOT NULL CHECK(source IN ('derived','custom')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done','skipped')),
  completed_at TEXT,
  notes TEXT,
  UNIQUE(league_id, season_number, key)
);
```

### 7.2 Derivation (round dates + template)

`ui/src/lib/portalAdmin/plan.ts` — pure, testable:

```
deriveTasks(season, rounds, now) → Task[]
```

Anchors per round `N` (`sub` = `submission_deadline`, `vote` = `voting_deadline`):

| key | title | due |
|---|---|---|
| `season.start` | **Season start — everyone is in Music League for this season** | R1 `sub` − 2 days |
| `r{N}.submission` | Make sure everyone meets the submission deadline | `sub` |
| `r{N}.voting-rules` | Update everyone on the voting rules | voting start (≈ `sub`, or `vote` − 3 days if unknown) |
| `r{N}.capture-spotify` | Capture the Spotify playlist | voting start + 1 h |
| `r{N}.ytm-playlist` | Create the YouTube Music playlist (refresh the YouTube refresh token first) | voting start + 3 h |
| `r{N}.digest-lede` | Have the ML bot generate the ledes for digest {N} | `vote` + 15 min |
| `r{N}.digest-generate` | Generate digest {N} | `vote` + 1 h |
| `r{N}.digest-edit` | Edit digest {N} | `vote` + 1 day |
| `r{N}.next-theme` | Check on the round {N+1} theme | `vote` − 3 days |
| `r{N}.next-reveal` | Reveal the hidden theme for round {N+1} at the right time | R{N+1} `sub` − 1 h |
| `r{N}.next-survey` | Set up the round {N+1} theme survey (when the round has one) | R{N+1} `sub` − 2 days |
| `r{N}.mlbot-email` | Confirm the Music League round-end email triggered the bot's digest job | `vote` + 15 min |
| `r{N}.round-review` | Round {N} process/workflow review — look for ways to improve | R{N+1} enters submission |
| `season.midseason` | Mid-season digest | midpoint of R1 `sub` and R{last} `vote` |
| `season.yearbook` | Yearbook awards for the season | R{last} `vote` + 3 days |
| `season.wrap` | Season wrap — publish the b-side for the season | R{last} `vote` + 5 days |

Notes:

- The user's checklist for round 1 is **exactly** the `r{N}` template applied to N=1 plus `season.start` and `r{N}.round-review` (R1 review lands when R2 enters submission). Nothing round-1-specific is special-cased.
- A round with no theme survey simply skips `r{N}.next-survey` (derive only when the survey app reports one, otherwise keep it and let an admin skip it).
- **Re-derivation:** running `deriveTasks` upserts by `key`. Rows with `status != 'open'` or `source = 'custom'` are never overwritten, and a derived row whose `due_at` moved is updated in place. Deleted derived rows are re-created on the next derive (a deleted-and-done row keeps its `key` and so is not resurrected).
- Season start, like every derived date, is editable in the UI; an edit flips that row to `source='custom'` from then on.

### 7.3 Views

**Day planner (default tab content)** — the next 7 days:

```
TODAY · Thu 8 Oct                                   3 open
  ▸ 14:00  Round 4 — make sure everyone meets the submission deadline   [round 4] [ ]
  ▸ 23:59  Round 4 — update everyone on the voting rules                [round 4] [ ]
  ✓ 09:10  Season start — everyone is in Music League                    [season]  [x]
TOMORROW · Fri 9 Oct                                1 open
  …
SAT 11 OCT … SUN 12 … MON 13 … TUE 14                days with nothing show as a dimmed "clear" row
```

- Rows: due time, title, round/season badge, one-tap done toggle, and an expandable detail + notes.
- Overdue tasks (past `due_at`, still `open`) pin to a **⚠ Overdue** group above today.
- Header: `Next 7 days · N open · M overdue`, plus a **Full season** switch.

**Full season layout** — everything grouped by round (`Season start` → `Round 1` → … → `Season wrap`), with per-round progress (`3 / 9 done`), an inline **+ Add task** (custom, with title / due / round / kind), drag-free due-date editing via a date-time input, and skip.

### 7.4 API (`/api/portal-admin/<slug>/…`)

| Method | Path | Body / returns |
|---|---|---|
| GET | `config` | full config incl. `runState` |
| PUT | `config` | whole or partial config → validated (`zod`) → saved → `portal.json` rewritten |
| GET | `sections` | section catalog + KPI catalog + member list (for the pickers) |
| POST | `run` | `{ sectionIds }` → 202 `{ jobId }` |
| GET | `run/:jobId` | `{ status, error?, lastRunAt? }` |
| GET | `plan?days=7` | derived+stored tasks, `days` window, plus `season` groups and totals |
| POST | `plan/derive` | `{ seasonNumber }` → re-derive; returns counts |
| PATCH | `plan/task/:id` | `{ status?, dueAt?, title?, detail?, notes? }` |
| POST | `plan/task` | custom task |
| DELETE | `plan/task/:id` | custom only |

Validation is zod; unknown fields are stripped; `dueAt` must be ISO-8601; `sectionIds` must be in the catalog.

---

## 8. Follow-up (recorded, not built)

- **Automation:** a host timer (same pattern as `ops/systemd/mlb-portal-stats.timer`) that calls a bot-ui internal runner: for each league, for each section whose `frequency` is due, execute it and stamp `runState`. Until then the UI shows *next due — pending automation*.
- Sending the 2.0 digest link via the approval tap (unchanged, separate piece).

---

## 9. Security / leak rules (must hold)

1. No admin host, no internal origin, no `mlb13` in any portal file, `portal.json`, or bundle — reuse `findLeaks` (`ui/src/lib/digest2/publishHtml.ts`) over `portal.json` including the new `roundLinks`.
2. `portal.json` carries **display** config only. Prompts, `runState`, task rows, emails, and any JWT never leave bot-ui.
3. `/api/portal-admin/*` is the only new digest-host route; GET/POST/PUT, ≤ 64 KB, Access-gated + JWT-verified, explicit route table, no page-route fallthrough.
4. Hidden-round privacy: `roundLinks` carries URLs and round numbers only; the current-round card takes its name/phase from the season feed, which already withholds hidden rounds.
5. b-side renders admin/server text **without `{@html}`**; links are https or same-origin relative only.
6. Excluding a player from *The family* is presentation, not access control — profile URLs remain reachable and no claim is made otherwise.

---

## 10. Testing

**Unit (bot-ui)**
- `plan.test.ts`: derivation against a 10-round season with real-shaped deadlines — every template key present exactly once; `season.start` before R1 submission; R1 review lands when R2 enters submission; re-derive is idempotent; `done` / `custom` rows survive re-derive; changed deadline moves an open derived row.
- `portalAdminConfig.test.ts`: default config has **every** catalog KPI selected; partial save merges; invalid frequency/section id rejected; `prompt: null` resets.
- `portalJson.test.ts`: `roundLinks` emitted for rounds with URLs, omitted when none; a leaky string in any link is caught by `findLeaks`.
- `kpiIds`: `buildKpis` emits the four ids; a read model without `id`s still validates.
- `auth.test.ts`: missing header → 401; wrong `kid` → 401 after one JWKS refresh; expired `iss`/`exp`/`aud` → 401; empty `PORTAL_ADMIN_EMAILS` → 401 (fail closed).

**Unit (bside, vitest)**
- current-round phase derivation from feed dates (submission vs voting, boundary at `songsDue`, no feed → no pill, hidden round never surfaces a name).
- KPI filter honours `portal.sections`, falls back to "all" when absent.
- family filter honours `players`, falls back to all.
- `homeCards.currentRound()` + link button visibility for partial/null links.

**Integration / manual**
- `caddy validate`; throwaway-container probe: DELETE → 405, 70 KB → 413, POST reaches stub, `/api/p/*` and `/api/survey/*` unchanged.
- With Access on the path: signed-out fetch → 103, signed-in admin fetch → config 200, direct `localhost:3002` with a spoofed email header → 401.
- Playwright on the real Second Best portal: admin tabs visible only when `adminSession().admin`, KPI picker pre-selects 4, toggling a section and reloading keeps it, Run now flips the button through running → updated.

**Regression:** `npm test` in repo root, `npm test` in `bside`, `npm run check`.
