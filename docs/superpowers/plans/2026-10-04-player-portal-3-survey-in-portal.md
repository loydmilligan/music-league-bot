# Player Portal Piece 3 (Survey Inside the Portal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players log in, take the survey, add themes, see My themes and vote in polls on the b-side portal, via a narrow `/api/survey/*` proxy to the survey app.

**Architecture:** Caddy on the digest host proxies `/api/survey/*` (GET/POST/PUT, ≤32 KB) to the survey container; the survey session adds a prefix-aware player API (+ roster, schema, feed, handoff). bot-ui stores a per-league survey key and exposes it in `portal.json` as `survey.apiBase`. The b-side SPA gains a typed survey client, schema validation, a name picker, Survey and My themes screens, and in-place poll voting.

**Tech Stack:** Caddy 2, docker compose, SvelteKit/Vitest (`ui/`), Svelte 5 SPA (`bside/`), Express (survey repo — other session).

**Spec:** `docs/superpowers/specs/2026-10-04-player-portal-3-survey-in-portal-design.md`

## Global Constraints

- The digest host proxies ONLY `/api/survey/*`, ONLY to `host.docker.internal:18474`, ONLY GET/POST/PUT (405 otherwise), bodies ≤ 32 KB; `/api/p/*` block byte-identical; no route to bot-ui added; comments record the deliberate exception.
- No admin host / internal origin in any portal file or bundle; b-side renders server text without `{@html}`; links only https or same-origin relative.
- Survey requests from the SPA: `credentials: 'same-origin'`, JSON, 10 s timeout.
- Survey key format `^[a-z0-9-]+/[a-z0-9-]+$`; `portal.json.survey.apiBase = ${digestBaseUrl()}/api/survey/<key>`.
- Never edit `~/Projects/boarz-season-2-survey` (survey session owns it). Never push. Never `git stash`. Tests never write real `data/`/`digests/`.
- `cd ui && npm run check` 0 errors; `cd bside && npm run check` no NEW errors (4 pre-existing); bside dist grep for `mlb[0-9]+|192\.168\.` clean.
- Commit trailers exactly, final paragraph, adjacent:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SAJiVCbHEqhbaSePqoQF5v
  ```

## Survey API shapes (from the survey session's 2026-10-04 review — the client codes against these)

- `GET auth/me` → `{authenticated, voterName, submitted, codeRequiredToSwitch}`
- `POST auth/select {voterName, code?}` → `{ok, voterName, submitted}`; 403 `{ok:false, codeRequired:true, error}`; 429 `{ok:false, error}`; 400 not in roster
- `POST auth/logout` → `{ok}`; `GET roster` → `{names: string[]}`
- `GET hub` → `{ok, voterName, submitted, tabs:{survey,mine,lineup,polls}, myThemes?, lineup?}`; `myThemes[] = {themeId,title,description,exampleSongs,addedAt,usedIn:[{roundId,position,title}|{roundId,position,revealAt,teaserTitle}]}`
- `GET polls` → `{ok, polls:[{id,roundId,roundPosition,status:'open'|'closed'|'applied',question,blurb,opensAt,closesAt,options:[{id,title,description,exampleSongs}],myVote,voterCount,eligibleCount,totals:{[optionId]:n}|null,appliedOptionId}]}`
- `PUT polls/:id/vote {optionId}` → `{ok, poll}`; 409 not open
- `POST submit {…schema fields}` → ok; 409 already submitted; 403 tab off
- `POST themes {themes:[{title?,description,exampleSongs?}]}` (≤10, description required) → `{ok, themes}`; 409 not submitted; 403 tab off
- `GET survey/schema` → spec §5.2; `GET feed` → season feed v1

## Review Focus
1. **Lock bypass** — signed-in state must come only from the server (`auth/me`), never inferred client-side; "Switch" must surface `codeRequired`. Pinned in Task 4.
2. **Double submit** — 409 "already submitted" must route the player to the add-themes form, not show a dead error. Pinned in Task 5.
3. **Tab off (403)** — must hide the tab and not loop. Pinned in Tasks 3/4.
4. **ratingGrid** — blank must be omitted (not 0); values 1–5 only. Pinned in Task 3 (validation) and Task 5 (payload).
5. **Proxy surface** — DELETE/PATCH 405, >32 KB 413, `/api/p/*` unchanged, `/api/survey/../` path tricks don't reach other upstreams. Pinned in Task 2 probe.

---

### Task 1: Survey key setting → portal.json `survey`
**Files:** `ui/src/lib/portal/portalJson.ts` (+test), `ui/src/routes/api/portal/[leagueId]/season/+server.ts` (+test), `ui/src/routes/content/+page.server.ts`, `+page.svelte`.
- `getSurveyKey(db, leagueId)/setSurveyKey(db, leagueId, key|null)` (validate regex, throw `invalid survey key`); `PortalJson.survey: { apiBase } | null`.
- Season settings endpoint body gains optional `surveyKey: string|null` (400 on invalid); Content form gets a "Survey (league/season)" input.
- Tests (RED first): set/get/clear + invalid keys (`Second-Best/S3`, `a`, `a/b/c`, `../x`); portal.json `survey.apiBase === ${digestBaseUrl()}/api/survey/second-best/season-3`; null when unset; endpoint 400 on invalid key, stores valid key, rewrites portal.json.
- Commit `feat(portal): per-league survey key → portal.json survey.apiBase`.

### Task 2: Digest host proxy (Caddy + compose)
**Files:** `Caddyfile.digest`, `docker-compose.yml` (digest-static `extra_hosts`).
- Implement spec §3 exactly (global `servers { trusted_proxies static private_ranges }`, `@surveyNotMethod`, `handle /api/survey/*` with noindex + no-store + 405 + 32KB + `reverse_proxy host.docker.internal:18474`), placed after `/api/p/*` and before other blocks; comment block recording the exception and forbidding admin/bot-ui routes; header namespace line.
- Validate with `caddy:2-alpine caddy validate`. Probe with a throwaway Caddy container (`--add-host host.docker.internal:host-gateway`) and a throwaway stub upstream on a free host port mapped as 18474-equivalent (edit only the probe copy of the Caddyfile to point at the stub): GET/POST/PUT → stub 200 with `X-Forwarded-Proto: https` preserved when the request carries it from a private-range client; DELETE → 405; 40 KB body → 413; `/api/survey/../api/p/x` normalizes and never reaches the stub as a non-survey path; `/api/p/x` still goes to its own upstream (502 in probe). Report codes; remove containers.
- Commit `feat(digest-host): narrow /api/survey/* proxy to the survey app (recorded exception)`.

### Task 3: b-side survey client + schema validation (pure, tested from ui/)
**Files:** `bside/src/lib/surveyApi.ts`, `bside/src/lib/surveySchema.ts`, `ui/src/lib/portal/surveyApi.test.ts`, `ui/src/lib/portal/surveySchema.test.ts`.
- `createSurveyApi(apiBase, fetchFn = fetch)` with methods `me, select(name, code?), logout, roster, hub, polls, vote(pollId, optionId), schema, submit(payload), addThemes(themes)`; errors: `SurveyError { status, code: 'unauthorized'|'forbidden'|'code_required'|'conflict'|'rate_limited'|'not_found'|'network', message }`; 10 s AbortController timeout.
- `validateSurvey(schema, values) → { ok, errors: Record<path, string> }` for all six types; `buildSubmitPayload(schema, values)` omits blank ratingGrid entries and empty optional fields.
- Tests (RED first): each method's URL/method/body (same-origin relative to apiBase); 403+codeRequired → `code_required`; 409 → `conflict`; 429 → `rate_limited`; timeout → `network`; validation per type with differing valid/invalid fixtures; payload omits blank ratings and keeps 1–5 numbers; values outside 1–5 rejected.
- Commit `feat(bside): typed survey client + schema validation`.

### Task 4: Sign-in, session state, nav
**Files:** `bside/src/App.svelte`, `bside/src/lib/atoms/PortalNav.svelte`, `bside/src/lib/atoms/NamePicker.svelte`, `bside/src/lib/types.ts`.
- On load with `portal.survey`: `me()`; if authenticated, `hub()`. Store `{ me, hub }` in App state; pass down.
- Nav: Survey / My themes tabs when signed in and `hub.tabs.survey` / `hub.tabs.mine`; "Sign in" when signed out; signed-in name + "Switch" + "Sign out" in a small header menu.
- NamePicker: roster list + filter; select → `select()`; on `code_required` show a code input and resubmit with code; on `rate_limited` show message; on success refresh `me`+`hub`.
- Tests: pure helper `visibleSurveyTabs(me, hub)` (signed out → none; tabs flags respected; 403-hidden tab stays hidden) in ui vitest; NamePicker render test via `svelte/server` (renders roster names, no `{@html}`).
- Commit `feat(bside): portal sign-in with name-lock code support`.

### Task 5: Survey screen (schema form, submit, add themes)
**Files:** `bside/src/routes/SurveyScreen.svelte`, `bside/src/lib/atoms/SchemaForm.svelte`, `bside/src/App.svelte` (route `/survey`).
- Renders `schema()` sections/fields (text, longtext, email, singleChoice, ratingGrid, repeatGroup with add/remove within min/max); client validation before submit; submit → `submit(buildSubmitPayload(...))`; 409 → switch to add-themes mode with the message; after submit show "Add more themes" (repeatGroup of title/description/exampleSongs, ≤10) → `addThemes`; success toasts; 403 → hide + note.
- Tests: SchemaForm SSR render for both leagues' fixture schemas (labels/help present, required markers, ratingGrid 1–5 radios + blank) via `svelte/server`.
- Commit `feat(bside): schema-driven survey + add-more-themes`.

### Task 6: My themes + in-place poll voting + same-origin feed
**Files:** `bside/src/routes/MyThemesScreen.svelte`, `bside/src/routes/SeasonScreen.svelte`, `bside/src/App.svelte` (route `/mine`), `bside/src/lib/portal.ts` (`survey` mirror).
- My themes: `hub.myThemes` list; usedIn revealed → "Used in Round N: <title>"; teaser → "Picked for Round N 🤫 (revealed <date>)".
- Season: prefer `${portal.survey.apiBase}/feed`, else `seasonFeedUrl`; when signed in with `tabs.polls`, load `polls()` and render vote buttons for `status==='open'` (mark `myVote`; on success update from returned `poll`); signed out → "Sign in to vote".
- Tests: pure `feedUrlFor(portal)` (survey preferred, fallback, null) and `pollViewModel(poll)` (open/closed/applied, myVote, totals only when closed) in ui vitest.
- bside check (no new errors) + build + dist grep clean.
- Commit `feat(bside): my themes, in-place poll voting, same-origin season feed`.

### Task 7 (survey session): survey-app half — spec §5 (router, roster, schema, feed, handoff, cookies, Origin, trust proxy, test league). Survey session's own tests; deploy; reply with commit. This plan's executors do not edit that repo.

### Task 8 (controller): go-live
- Merge; detect-changes; deploy bot-ui; recreate digest-static (Caddy + extra_hosts); deploy bside (`bside.js`/`bside.css` only, `.bak`); set survey keys: Second Best `second-best/season-3`, Boarz `boarz/season-2`. The `test/season-0` league is exercised directly through the proxy (curl with a cookie jar) — it is not attached to any portal page.
- Smoke against `test/season-0` (spec §7) using curl through `https://digest.mattmariani.com/api/survey/test/season-0/…` with a cookie jar, plus Playwright on the real Second Best portal for signed-out views (Sign in, Season feed same-origin, no admin host). No real player data written.
- Report; Matt then tells the survey session to switch mlsurvey player pages to redirect (handoff) — not part of this plan's execution.
