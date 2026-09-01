# Spike: Music League voting page — URL, fetchability, parse recipe

**Date:** 2026-09-01 · **Scope:** recon only, GET-only, no writes.
**Subject:** Boarz II Men (`lid = 71598b6952064ca4afe4baf437495604`),
Round 7 "Stranger Danger" (`rid = 2372fb08b6364ce4ab02726eac379efb`), voting closes 2026-09-03.
**Captured HTML:** `.superpowers/research/voting-spike/` (8 files, 568 KB).

---

## 1. Confirmed URL(s) — and everything tried

| # | Request (GET only) | Headers | Status | Content-Type | Bytes | Verdict |
|---|---|---|---|---|---|---|
| 1 | `/l/{lid}/{rid}/` | plain | 200 | `text/html` | 70,553 | Round shell. Contains **no ballot**; delegates its body to `hx-get="-/results"`. |
| 2 | `/l/{lid}/{rid}/-/results` (live round) | HX-Request | 200 | `text/html` | **422** | **Empty during voting.** Only the "My song(s)" filter button. Not a source of comments pre-close. |
| 3 | `/l/{lid}/-/rounds` | HX-Request | 200 | `text/html` | 53,444 | **This is where the URL is discoverable.** Current-round card carries `href="/l/{lid}/{rid}/vote/"` and `hx-get="-/vote-status/{rid}"`. |
| 4 | **`/l/{lid}/{rid}/vote/`** (live round) | plain | **200** | `text/html` | **157,620** | ✅ **THE VOTING PAGE.** Full server-rendered ballot: 10 song blocks, tracks, artists, albums, Spotify URIs, submitter comments. |
| 5 | `/l/{lid}/{rid}/vote/-/songs` (hypothesis) | HX-Request | **404** | `text/plain` | 19 | ❌ Hypothesis wrong. There is **no** `/-/` fragment under `/vote/`; the ballot is inlined in the full page. |
| 6 | `/l/{lid}/-/vote-status/{rid}` | HX-Request | 200 | `text/html` | 5,656 | **New, previously unmapped endpoint.** Voting analogue of `/-/submission-status/{rid}`. Renders `Done (4)` / `Waiting for (6)` avatar groups. |
| 7 | `/l/{lid}/098a4ace…/vote/` (a **completed** round) | plain | **200** | `text/html` | 160,613 | ✅ **Still serves the full ballot after the window closes** — see §5, this is the big one. |
| 8 | `/l/{lid}/098a4ace…/-/results` (completed) | HX-Request | 200 | `text/html` | 102,891 | Contains submitter comments too, once results are published. |

**Confirmed voting-page URL: `GET https://app.musicleague.com/l/{lid}/{rid}/vote/`** — a full page, not a fragment.

---

## 2. Plain HTTP or browser? — **Plain HTTP. No browser needed.**

Evidence:
- A bare `curl_cffi` `Session(impersonate="chrome")` GET with the cookies from
  `~/.config/cli-web-musicleague/auth.json` returned **200 / 157,620 bytes** on the first try — no Cloudflare
  challenge, no login redirect, no retry.
- The ballot is **server-rendered in the initial HTML response**. All ten `<div class="song">` blocks — with
  track title, artist, album, album art, Spotify URI, mp3 preview URL and the submitter's comment text —
  are present as literal markup in the response body. Verified by parsing the saved file with BeautifulSoup
  offline: 10 song blocks, 10 `input[name="uri"]`, 2 populated comment spans.
- Alpine.js / HTMX on the page are used only for *interaction* (vote increment, autosave, collapse).
  They fetch nothing on load. The single `hx-get` on the page is the unrelated league-chat widget.
- HX-Request header is **not** required for `/vote/` (it is a page, not a fragment). It *is* appropriate for
  `/-/vote-status/{rid}`.

No headless browser was launched during this spike.

---

## 3. Parse recipe (MUSICLEAGUE.md style)

- **Voting ballot** (`/l/<lid>/<rid>/vote/`): song blocks are `div.songs > div.song`, ids `song-0 … song-N`,
  ordered **alphabetically by Spotify track id** (same ordering as the round playlist). Per block:
  - **Spotify URI** — `input[name="uri"]` → `value` (e.g. `spotify:track:03W2WiY9OSnUI4F9dy9L60`).
    Also duplicated in the block's `x-init` and in `audio[id^="audio-spotify:track:"]`.
  - **Track title** — `.col.text-truncate.order-3 > h6`
  - **Artist** — `.col.text-truncate.order-3 > span:nth-of-type(1)` (`span.d-block.text-truncate`)
  - **Album** — `.col.text-truncate.order-3 > span.text-body-secondary`
  - **Album art** — `img[alt="Album art"]` → `src`
  - **30 s preview mp3** — `audio source` → `src` (absent for some tracks; 9 of 10 had one)
  - **Submitter's comment** — `p.bg-body-tertiary span.text-break.ws-pre-wrap` → text.
    **Presence is signalled by the parent `<p>`'s `x-show` attribute**: `x-show="true"` ⇒ a real comment;
    `x-show="false"` ⇒ no comment and the span is empty. Filter on `x-show == "true"` (or simply on
    non-empty stripped text — both agree in the sample).
  - **Is it mine?** — the block's `x-data` contains `mine: true` / `mine: false`. Mine also renders a
    `.card-header` reading "You submitted this song".
  - **My existing ballot** (only after you have voted/drafted) — `div.song` gains `data-weight="N"` and
    `data-comment="…"` attributes. Absent entirely on a round you have not voted in.
  - **Round theme** — `h5.card-title` (name) and `p.card-text[data-description]` → `data-description`
    (the description is in the *attribute*, rendered client-side by Alpine `x-html`; the element's text is empty).
- **Vote status** (`/l/<lid>/-/vote-status/<rid>`): same shape as submission-status — "Done (N)" and
  "Waiting for (N)" groups of `/user/<uid>/` avatar links.
- **Submitter comment on a completed round** (`/l/<lid>/<rid>/-/results`): `p.bg-body-tertiary span.text-break.ws-pre-wrap`
  inside the song card's first `.card-body` — i.e. **the same span class as the ballot**, sitting *above* the
  `.card-footer` that holds the voter breakdown. Attribution to the submitter is the `h6` name in the card header.

---

## 4. Are comments present for every song? — **No. 2 of 10.**

Stranger Danger, live ballot (`song-0 … song-9`, 10 songs / 10 players / 1 song per round):

| block | track | submitter comment |
|---|---|---|
| song-0 | Watermelon — John + Jane Q. Public | — (this is Mashew's own) |
| song-1 | Another Year — Animals As Leaders | — |
| **song-2** | Old Town Road (Remix) — Lil Nas X | "I'm hoping this crossover banger has escaped the notice of the punk contingent until now" |
| song-3 | Once in a Lifetime — Stick Figure | — |
| song-4 | Stony Gate — Fergus McCreadie | — |
| **song-5** | Who's Gonna Build Your Wall? — Tom Russell | "For MAGA Shane" |
| song-6 | It Is So Nice To Get Stoned — Ted Lucas | — |
| song-7 | The Clapping Song — Shirley Ellis | — |
| song-8 | Dawn of the Dead — Does It Offend You, Yeah? | — |
| song-9 | Joe — Alabama Shakes | — |

**2 / 10 (20 %).** For comparison, completed round "Surrender Monkeys" (`098a4ace…`) had **4 / 10**.

This is expected: the submit form has a per-song `visible_<n>=on` checkbox — a submitter comment is only shown
during voting if the submitter opted to make it visible. Project B must treat comments as **sparse and optional**,
not one-per-song.

---

## 5. Things that will surprise whoever plans Project B

1. **THE DEADLINE IS NOT REAL.** `/l/{lid}/{rid}/vote/` returns **200 with the full ballot for rounds that have
   already completed** (verified on `098a4ace…`, a finished round). Submitter comments, track metadata and even
   Mashew's own past votes (`data-weight`) and voter comments (`data-comment`) are all still there. So Project B
   **can be backfilled across historical rounds** and does not have to be built before 2026-09-03. The urgency
   framing in the task brief does not hold.
2. **Two sources, and the cheaper one only works after the fact.** During the voting window, `/-/results` is
   *empty* (422 bytes) and `/vote/` is the only source. After the window closes, `/-/results` also carries the
   submitter comment **and additionally attributes it to a named user** (`h6` in the card header) — which `/vote/`
   never does, because the ballot is anonymous by design. If Project B needs *who said it*, it needs
   `/-/results` (post-close) or the export zip; `/vote/` gives comment-per-URI only.
3. **`/vote/` is a POST target and the page is wired to autosave.** The ballot's outer div carries
   `hx-post="./?draft=1" hx-trigger="pointChange from:body delay:1s" hx-include="body"`. A GET is completely
   safe, but *anything that renders and interacts with this page* (a headless browser that clicks, or an errant
   POST to the same URL) writes a draft ballot to the owner's real account. Keep the scraper GET-only; never
   drive this page in a browser.
4. **No `/-/` fragment exists under `/vote/`.** `/vote/-/songs` is a hard 404 (`text/plain`). The whole 157 KB
   page must be fetched and parsed. It is ~2.2× the size of the round shell.
5. **Discovery is via `/l/{lid}/-/rounds`**, not the round page. The round shell (`/l/{lid}/{rid}/`) contains
   *zero* references to voting — no "vote" substring anywhere in its 70 KB. Only the rounds-list fragment emits
   the `/vote/` href, and only for the round currently in its voting window. A scraper that walks the round page
   looking for a vote link will find nothing.
6. **Newly mapped endpoint:** `GET /l/{lid}/-/vote-status/{rid}` → "Done (N)" / "Waiting for (N)". Not in
   MUSICLEAGUE.md. Useful as a cheap poll for "is this round still in its voting window / has everyone voted".
7. **The comment's empty-vs-present signal is an Alpine attribute, not the DOM.** The `<p>` wrapper is emitted
   for *every* song, always, with an empty span when there is no comment. Naive "find the quote paragraph" logic
   yields ten empty strings. Gate on `x-show="true"`.
8. **Comment text is HTML-entity-encoded and preserves whitespace** (`ws-pre-wrap`, curly apostrophes, trailing
   spaces, embedded newlines). Max length 1000 chars. Unescape and strip deliberately.
9. **Album field can look like a bug and isn't** — Lil Nas X's album really is `"7"`.
10. **No anti-bot friction observed.** `impersonate="chrome"` + session cookies, 8 requests, zero challenges,
    zero 429s, no `Retry-After`. Cloudflare did not interpose once.
11. **No pagination.** All ten songs in one response. Untested at larger league sizes (see §6).

---

## 6. Could NOT determine

- **Whether the page changes after *you* have voted.** Mashew has **not** voted in Stranger Danger (he is in the
  "Waiting for (6)" group), so the live ballot carried no `data-weight` / `data-comment` attributes. The completed
  round *did* carry them, which strongly implies the live page gains them once a draft is saved — but that was
  inferred from a finished round, not observed on a live one. **Not verified, and not verifiable without casting
  a vote**, which is out of scope. The submitter-comment markup is independent of this and should be unaffected.
- **Pagination / lazy-loading at larger song counts.** Boarz is 1 song/round × 10 players = 10 songs. A league with
  many more songs per round might paginate or lazy-load. Untested.
- **Behaviour before the voting window opens** (round still accepting submissions) — `/vote/` was not requested
  for an upcoming round.
- **Non-member / non-commissioner access.** Only tested as an authenticated league member who is also admin.
- **Whether `/vote/` remains available indefinitely** or only for some retention window after close. One completed
  round was checked; not swept across the league's history (deliberately — the brief asked for a small number of
  requests).
- **Rate limits.** Eight requests is not a probe of throttling.

---

## Appendix — captured artifacts

All under `.superpowers/research/voting-spike/`:

| File | What |
|---|---|
| `…_2372fb08…_vote.html` | **the live Stranger Danger ballot** (157 KB) — primary evidence |
| `…_2372fb08….html` | round shell |
| `…_2372fb08…_d_results.html` | the 422-byte empty results fragment |
| `…_2372fb08…_vote_d_songs.html` | the 404 body |
| `…_d_rounds.html` | rounds list (where the `/vote/` href lives) |
| `…_d_votedstatus_2372fb08….html` | vote-status fragment |
| `…_098a4ace…_vote.html` | completed-round ballot — proof of post-close availability |
| `…_098a4ace…_d_results.html` | completed-round results |

No repo code was modified. No POST was issued. The session was not touched.
