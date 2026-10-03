# Player portal — piece 1: shell, digests, live Season section — design spec

**Date:** 2026-10-03 · **Status:** design approved in chat 2026-10-03; spec pending review
**Target:** live before round 1 of the next season closes (~2026-10-09).
**Lead:** music-league-bot session. **Survey half:** boarz-season-2-survey session (owns `~/Projects/boarz-season-2-survey`; builds §6 and signs off on the plan).
**Inputs:** `~/Projects/boarz-season-2-survey/docs/ops/player-portal-survey-side-brief.md`; `2026-10-02-digest-2.0-generate-finalize-share-design.md` (2.0 publish, leak gate).

## 1. Goal

Players get one bookmarkable portal per league — the existing b-side page
`https://digest.mattmariani.com/<leagueSlug>/` — that links to the latest digest, lists every
historical digest, and shows the live season (lineup, reveals, polls) fed by the survey app, handing
off to `mlsurvey.mattmariani.com` for anything that needs a login. Players never see the admin host.

**Program context (not built here):** piece 2 nightly live stats page, piece 3 research panel, piece 4
clean per-league admin, piece 5 song rating (survey side, needs identity).

**Success criteria**
1. A 2.0 Finalize & share makes that round's digest appear (linked to `/d2/<slug>`) on the portal's
   Digests screen and Home "Read the latest digest" button within seconds — no Update run needed.
2. Digests lists **every** completed round of the league (all seasons), newest first, each linking to
   its 2.0 digest if finalized, else its 1.0 share if one exists, else shown without a link.
3. The Season section renders the survey feed: published lineup (teasers without titles + reveal
   time), open polls (question + options, "Vote" → mlsurvey), closed polls (totals), "Add themes" when
   the survey is open. If the feed is unreachable or not configured, it degrades to one
   "Open season hub" link (or hides when no hub URL exists).
4. No portal file or bundle contains the admin host (`new URL(appBaseUrl()).host`) or the internal origin.
5. Existing b-side Home / Profile / Archive keep working for all four published leagues.

## 2. Decisions (2026-10-03)

| Question | Decision |
|---|---|
| Front door | b-side league page (static, no login). Survey app stays the login backend. |
| How the archive learns about 2.0 | New deterministic `portal.json` per league, rewritten on every 2.0 finalize (instant). Independent of the Update flow's LLM `archived_rounds` bookkeeping. |
| Update/read-model archive | Its `digestUrl` also prefers 2.0 (shared helper), so the two never disagree. |
| Season data | Fetched live in the browser from the survey feed (CORS, GET, no credentials). |
| Feed URL config | Per-league setting, edited on the Content tab for now (piece 4 moves it into the admin). |
| Identity for "what I submitted" | Not needed (ML results are public post-round) — relevant to piece 3. |

## 3. `portal.json` (music-league-bot)

Written to `DIGESTS_DIR/<leagueSlug>/portal.json` (leagueSlug from `dashboard_sites.slug`; leagues
with no `dashboard_sites` row are skipped silently). Shape (v1):

```json
{
  "version": 1,
  "generatedAt": "2026-10-03T21:00:00Z",
  "seasonFeedUrl": "https://mlsurvey.mattmariani.com/feed/second-best/season-3.json",
  "seasonHubUrl": "https://mlsurvey.mattmariani.com/second-best/season-3/",
  "digests": [
    { "roundId": 152, "n": 34, "season": 1, "theme": "These Go to 11",
      "date": "2026-09-24T…", "winnerSong": "…", "winnerArtist": "…",
      "digestUrl": "https://digest.mattmariani.com/d2/SZiywbU_DJQ1q0Is", "digestKind": "v2" }
  ]
}
```

- `digests` = the same completed-round set and ordering as today's `buildArchive` (vote-cast or
  `phase='complete'`), newest first; `digestKind` ∈ `v2 | v1 | null`.
- Link rule (shared helper `digestLinkForRound(db, roundId)` in `ui/src/lib/portal/digestLinks.ts`):
  `digest2_shares` → `${digestBaseUrl()}/d2/<slug>`; else `digest_shares` → `${digestBaseUrl()}/d/<slug>`;
  else null. `buildReadModel.buildArchive` and the Update endpoint's single-entry builder both switch to
  this helper.
- `seasonFeedUrl` / `seasonHubUrl` from settings `portal_season_feed_url:<leagueId>` /
  `portal_season_hub_url:<leagueId>` (null when unset). Each must be an `https://` URL; validated on save.
- `writePortalJson(db, leagueId)` (`ui/src/lib/portal/portalJson.ts`): build → leak-check the
  serialized JSON with the existing `findLeaks` host check (forbidden: app host, internal origin) →
  atomic write (`.portal.json.tmp` + rename). Returns `{ path, digests }` or `null` (no site).
- Triggers: (a) end of a successful `publishDigest2` (failure to write portal.json is logged and
  surfaced as a non-fatal warning in the publish response, never fails the publish); (b) end of
  `publishSite` and of a successful Update; (c) saving the feed URL setting.

## 4. b-side portal shell (`bside/`)

- Routes: `/` Home, `/p/:id` Profile, `/archive` → renamed in UI to **Digests** (path stays
  `/archive` so existing links work), new `/season`.
- Shared top nav component on every screen: Home · Digests · Season (Season hidden when neither a
  feed URL nor hub link is available). Stats/Research slots reserved for pieces 2–3, not rendered.
- Data: App fetches `read_model.json` (as today) and `portal.json` (new; optional — missing/invalid →
  fall back to `read_model.archive` for Digests and hide Season).
- **Digests screen:** lists `portal.digests` grouped by season, newest first; card shows theme, date,
  winner, and links to `digestUrl` when present ("No digest" otherwise). Reuses existing archive card
  styling.
- **Home:** latest-round card gains a "Read the latest digest" button → first `portal.digests` entry
  with a `digestUrl`.
- **Season screen:** fetches `seasonFeedUrl` (no credentials, 8s timeout). Renders per §6 contract.
  Unknown `version` > 1 fields are ignored; unknown `version` major → fallback link. All survey URLs
  open in the same tab.
- Build/deploy: `cd bside && npm run build` → copy `dist/` to `digests/_bside/` (existing procedure).

## 5. Feed URL setting (Content tab)

Per-league "Season feed URL" and "Season hub URL" inputs on each league card in `/content` with Save →
`PUT /api/portal/<leagueId>/season` `{ feedUrl: string | null, hubUrl: string | null }` → validates
each as an https URL (or null to clear), stores the settings, rewrites portal.json, returns
`{ ok, portalWritten }`.

## 6. Survey-side contract (built by the survey session)

**Endpoint:** `GET https://mlsurvey.mattmariani.com/feed/<league>/<season>.json`
(`/feed/second-best/season-3.json`, `/feed/boarz/season-2.json`).

**Headers:** `Access-Control-Allow-Origin: https://digest.mattmariani.com`, `Vary: Origin`,
`Cache-Control: public, max-age=60`, `Content-Type: application/json`. No cookies read or set. OPTIONS
not required (simple GET).

**Body (v1):**
```json
{
  "version": 1,
  "generatedAt": "ISO",
  "league": { "key": "second-best", "name": "SECOND BEST & FRIENDS", "season": 3, "mlLeagueId": "32c5…|null" },
  "portalUrl": "https://digest.mattmariani.com/yFfer5bePejN4PRXvgAfMg/",
  "links": { "hub": "https://mlsurvey…/second-best/season-3/", "polls": "…#polls", "mine": "…#mine", "survey": "…#survey" },
  "survey": { "open": true },
  "lineup": [
    { "round": 2, "status": "revealed", "title": "I Bought the Soundtrack", "description": "…",
      "commentRule": { "level": "required|suggested", "prompt": "…", "hiddenUntilVotingEnds": false } ,
      "credit": ["Sarah Black"],
      "startsAt": "ISO|null", "songsDue": "ISO|null", "votesDue": "ISO|null" },
    { "round": 10, "status": "teaser",
      "teaser": { "title": "Poll Position", "description": "Players will vote on final theme…" },
      "revealAt": "ISO|null", "startsAt": "ISO|null", "songsDue": "ISO|null", "votesDue": "ISO|null" }
  ],
  "polls": {
    "open": [ { "id": "p1", "round": 10, "question": "…", "blurb": "…|null",
                "options": [ { "id": "o1", "label": "…", "description": "…|null" } ],
                "closesAt": "ISO|null" } ],
    "closed": [ { "id": "p0", "round": 9, "question": "…", "blurb": "…|null",
                  "results": [ { "label": "…", "votes": 4 } ], "winner": "…|null", "closedAt": "ISO|null" } ]
  }
}
```

**Field meanings (agreed with the survey session 2026-10-03):**
- **Lineup source = the published season only** (Matt confirmed Second Best S3 is published). Unpublished
  draft edits never appear.
- `teaser` is an object from the survey's `reveal.teaserTitle` / `reveal.teaserDescription`; an empty
  title is sent as "Mystery round" (the name already pushed to Music League); description may be "".
- `commentRule` is an object or `null` (a "none" rule → `null`).
- `credit` is an array of submitter names (multiple linked themes possible); `[]` = no credit.
- Dates come from the survey's Music League schedule (round-1 start + submission/voting days, with
  overrides) — `null` until the schedule is set. Not a live Music League read.
- `survey.open` = the Survey tab's league-wide default in Player access (per-player overrides ignored).
- Poll `round` = the round position the poll decides. Option `label` = option title || description.
  Closed-poll `results` sorted by votes descending; `winner` = applied option label or `null`.
- **Poll visibility (Matt decision 2026-10-03):** only open and closed polls are in the feed; draft
  polls (no open time) are invisible everywhere. Candidate themes that must stay secret until a set
  time are handled by scheduling the poll's open time — e.g. Second Best round 10's poll opens at
  round 8's start (Sun Nov 22, 12:00 AM PT). No options-withheld case exists in v1.

**Privacy (enforced survey-side):** teaser rounds never carry `title`/`description`/`commentRule`/
`credit`; open polls carry no counts or ballots; draft polls are absent; no player-identifying
data except theme `credit` (already public in ML round descriptions).

**Nav strip on survey pages:** a slim top bar matching the b-side tokens (`bside/src/colors_and_type.css`:
background `--ink-1`, text `--ink-8`, accent `--mash-pulp` `#ff5b2e`, fonts Bricolage Grotesque
display / Inter Tight body) with "← <League name> league page" linking to the league's `portalUrl`.
League → b-side slug: Second Best = `yFfer5bePejN4PRXvgAfMg`, Boarz = `U7o8L06wfe1HILD1qzk-wg`.

## 7. Error handling
- portal.json write failure on finalize → publish still 200, response carries `portalWarning`; admin
  bar shows it. Leak-check failure → nothing written, warning names the snippet.
- Feed fetch failure / non-200 / invalid JSON / CORS error → Season shows the fallback
  "Open season hub" link from `portal.seasonHubUrl` (Season tab hidden when both URLs are null).
- Unknown league id on the feed-URL endpoint → 404; invalid URL → 400.

## 8. Testing
- Unit: `digestLinkForRound` (v2 preferred over v1; v1 fallback; null) with fixtures where answers
  differ; `buildPortalJson` (all seasons, newest first, kinds, feed URL); `writePortalJson` (atomic,
  no site → null, leak → nothing written); season-settings endpoint (400/404/200 + rewrite); publish hook
  (portal.json rewritten after a successful publish, untouched after a failed one); buildArchive +
  Update entry prefer v2.
- b-side: `svelte-check` clean; a unit test for the feed parser/normalizer (version handling, teaser
  privacy-safe rendering, missing fields) in `bside` if a test runner exists, else a pure TS module
  tested from `ui/` vitest.
- Integration/smoke (post-deploy): finalize a round → portal.json updated, Digests shows the `/d2/`
  link; Season renders against the live survey feed (after the survey half ships) and falls back when
  the feed URL is pointed at a 404; no admin host in `portal.json` or `_bside/` bundle.

## 9. Out of scope
Nightly stats (piece 2), research panel (piece 3), unified admin (piece 4), song rating (piece 5),
personalised "who am I" hand-off, changes to the Update flow's LLM pipeline beyond the link helper.
