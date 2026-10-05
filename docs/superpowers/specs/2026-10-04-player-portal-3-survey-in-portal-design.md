# Player portal — piece 3: survey inside the portal — design spec

**Date:** 2026-10-04 · **Status:** design approved in chat 2026-10-04 (Matt); spec + plan pending review and the survey session's sign-off.
**Program:** b-side is the ONLY player page. 2 live stats (LIVE) → **3 survey in portal** → 4 per-league portal admin (Access path) → 5 research → 6 song rating.
**Owners:** music-league-bot session (lead): digest host + b-side + bot-ui settings. boarz-season-2-survey session: survey app half (§5), signs off on this spec and the plan.

## 1. Goal

Players log in, take the league survey, add themes, see "my themes", and vote in theme polls entirely
on `https://digest.mattmariani.com/<league>/`. The survey site stops being a player destination
(its player pages redirect to the portal after switch-over). Admin stays off the digest host.

**Success criteria**
1. From the portal a player can: pick their name (with the name-switch lock code when required), submit
   the league survey (Boarz and Second Best forms), add more themes, see My themes, and vote in an open poll
   — all requests same-origin under `/api/survey/<league>/<season>/`.
2. Tabs follow the player's access (`hub.tabs`), as on the survey site today.
3. A player redirected from the old survey site arrives signed in as the same name (handoff token), so the
   name lock carries over.
4. The digest host forwards **only** `/api/survey/*`, **only** to the survey app, **only** GET/POST/PUT,
   bodies ≤ 32 KB; `/api/p/*` unchanged; nothing reaches bot-ui through the new route; no survey admin
   route is reachable under `/api/survey/*`.
5. The portal's Season screen reads the feed same-origin; no admin host anywhere.

## 2. Decisions (2026-10-03/04)
| Question | Decision |
|---|---|
| Survey login on the digest host | Proxy the survey API (`/api/survey/*` → survey app); host-only cookies on digest host. |
| Forms | API-only + a form-schema endpoint; the portal renders both leagues' forms from the schema. |
| Lock migration | Signed, 2-minute, single-use handoff token minted by the old survey session on redirect. |
| Admin | Not in this piece (piece 4, Cloudflare Access path + JWT verification). |
| Caddy rule | Deliberately breaks the "only `/api/p/*` is proxied" rule — recorded in `Caddyfile.digest` comments and here. Risk accepted: it reaches only the survey app, which is already public at mlsurvey. |

## 3. Digest host (music-league-bot)

Network path: Cloudflare edge → cloudflared (host) → `127.0.0.1:8088` (digest-static Caddy) →
`host.docker.internal:18474` (survey container).

- `docker-compose.yml` digest-static: `extra_hosts: ["host.docker.internal:host-gateway"]`.
- `Caddyfile.digest` global options: `servers { trusted_proxies static private_ranges }` so the
  `X-Forwarded-Proto: https` / `X-Forwarded-For` set by cloudflared survive; `Cf-Connecting-IP` passes
  untouched (Caddy forwards request headers by default).
- New block (before `@league`, after `/api/p/*`):
  ```
  @surveyNotMethod not method GET POST PUT
  handle /api/survey/* {
      header X-Robots-Tag "noindex, nofollow"
      header Cache-Control "no-store"
      route {
          respond @surveyNotMethod 405
          request_body { max_size 32KB }
          reverse_proxy host.docker.internal:18474
      }
  }
  ```
  plus a comment block stating the exception to the `/api/p/*`-only rule and what may never be added
  (admin paths, bot-ui).

## 4. Portal (b-side + bot-ui)

### 4.1 Settings → portal.json
- Content tab league card: "Survey (league/season key)" input, e.g. `second-best/season-3`, validated
  `^[a-z0-9-]+/[a-z0-9-]+$`. Setting `portal_survey_key:<leagueId>`.
- `portal.json` v1 gains `survey: { apiBase: string } | null` where
  `apiBase = ${digestBaseUrl()}/api/survey/<key>` (absolute https on the digest host).
- The Season screen prefers `${survey.apiBase}/feed`; falls back to the existing `seasonFeedUrl`
  during transition. Feed/hub URL fields stay until switch-over is verified, then are removed in a follow-up.

### 4.2 b-side SPA
- `bside/src/lib/surveyApi.ts` — typed client over the §5 endpoints (`credentials: 'same-origin'`,
  JSON, timeout 10 s, maps 401/403/409/429 to typed errors).
- `bside/src/lib/surveySchema.ts` — schema types (§5.2) + pure client-side validation mirroring the
  server rules (required, maxLength, minItems/maxItems, rating 1–5).
- Session state in `App.svelte`: on load (when `portal.survey`), `GET auth/me`; then `GET hub` when
  authenticated.
- Nav: **Survey** and **My themes** tabs shown when signed in and the corresponding `hub.tabs` flag is on;
  when signed out, a "Sign in" item opens the name picker. Season stays.
- `NamePicker.svelte` — roster list (`GET roster`), select → `POST auth/select`; on `codeRequired` show a
  code field; on 429 show the error; "Not you? Switch" for signed-in players; logout.
- Routes `/<slug>/survey` (`SurveyScreen.svelte`: schema-driven form when `!submitted`; after submit,
  "Add more themes" repeat form → `POST themes`) and `/<slug>/mine` (`MyThemesScreen.svelte`:
  `hub.myThemes`, `usedIn` revealed vs teaser "picked for Round N 🤫").
- Season screen: open polls get in-place voting when signed in and `hub.tabs.polls` (`PUT polls/:id/vote`),
  showing `myVote`; signed-out → "Sign in to vote". Totals only after close (server rule).
- Rendering rules: no `{@html}` with server text; links only https or same-origin relative.

## 5. Survey-app contract (built by the survey session)

### 5.1 Routing, cookies, security
- Prefix-aware router: `/api/survey/boarz/season-2/*` → BOARZ S2 player API; `/api/survey/second-best/season-3/*`
  → Second Best S3 player API. Old mlsurvey paths stay live until switch-over.
- Endpoints under each prefix: `GET auth/me`, `POST auth/select {voterName, code?}`, `POST auth/logout`,
  `GET roster` → `{ names: string[] }` (**new**), `GET hub`, `GET polls`, `PUT polls/:id/vote {optionId}`,
  `GET themes`, `POST themes {themes}`, `POST submit`, `GET survey/schema` (**new**), `GET feed` (**new
  location**, same v1 body as today), `GET handoff?t=…` (**new**). Shapes as today (see the survey
  session's 2026-10-04 review message; recorded in the plan).
- Cookies (session + name-lock device): host-only, `Path=/api/survey/<league>/<season>/`, HttpOnly,
  Secure, SameSite=Lax, per league.
- Origin allow-list on POST/PUT: `https://digest.mattmariani.com` (+ mlsurvey origin during migration) → 403 otherwise.
- `trust proxy = "loopback, uniquelocal"`; rate-limit key = `Cf-Connecting-IP` only when the immediate peer
  is loopback/private, else `req.ip`.
- **No admin route under `/api/survey/*`.**

### 5.2 Form schema (`GET survey/schema`)
`{ version: 1, sections: [{ heading, intro?, fields: Field[] }] }` with
`Field = { key, type, label, help?, placeholder?, required?, maxLength?, options?: [{value,label,help?}],
items?: string[] (ratingGrid), fields?: Field[] (repeatGroup), minItems?, maxItems? }`,
`type ∈ text | longtext | email | singleChoice | ratingGrid | repeatGroup`. Rating values 1–5 or blank;
ratingGrid submits `{ [item]: n }`. BOARZ and Second Best field lists per the survey session's review.

### 5.3 Handoff
When a signed-in player hits an old mlsurvey player page after switch-over, the survey app redirects to
`https://digest.mattmariani.com/api/survey/<league>/<season>/handoff?t=<token>` (signed, 2-minute TTL,
single-use, bound to the voter name), which sets the portal-path session + device cookies and 302s to the
league's portal `…/<slug>/survey`. Invalid/expired token → 302 to the portal without signing in.

### 5.4 Test league
A hidden `test/season-0` league with roster `["Portal Tester A", "Portal Tester B"]`, both schemas'
field types represented, and one open poll — used for the go-live smoke so no real player data is written.
Not linked from any page.

## 6. Error handling
- Survey app unreachable → portal shows "The season hub is unavailable right now"; Season falls back to cached
  feed behaviour (piece 1).
- 409 already submitted → show "You've already submitted — add more themes below".
- 403 tab off → hide the tab and show a short note.
- 429 → show the server's message.

## 7. Testing
- music-league-bot: survey-key setting validation + portal.json `survey` field; surveyApi (mocked fetch:
  happy paths + 401/403/409/429 mapping); surveySchema validation (each type, required/maxLength/min/max,
  rating bounds) with fixtures where valid/invalid differ; Caddy validate + throwaway-container probe
  (405 for DELETE, 413 for >32 KB, 200 passthrough to a stub upstream, `/api/p/*` unaffected, headers
  `X-Forwarded-Proto` preserved).
- Survey session: its own tests for router, cookies path, Origin check, trust proxy/IP keying, schema,
  roster, handoff (signature, TTL, single use), no admin under prefix.
- Go-live smoke (test league only): sign in as Portal Tester A, submit survey, add a theme, vote, My themes
  shows it; lock: Tester B switch requires code; handoff from mlsurvey lands signed in; request hosts on the
  portal ⊆ {digest.mattmariani.com, fonts, cloudflareinsights}; no `mlb13`.

## 8. Out of scope
Portal admin incl. survey admin (piece 4), research (5), song rating (6), removing the feed/hub URL settings
(follow-up after switch-over), redirecting mlsurvey player pages (done by the survey session after Matt's go).
