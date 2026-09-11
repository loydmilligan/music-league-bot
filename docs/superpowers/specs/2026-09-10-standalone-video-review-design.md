# Standalone (roundless) video-playlist reviews — design

**Date:** 2026-09-10
**Status:** Proposed — awaiting approval
**Motivating case:** "Songs mentioned in the Boarz chat during round 150" — a real
playlist built by hand today (`PLbO8wXGrBnL8`, "I Want My MTV") because none of the
existing machinery would take it.

---

## 1. Problem

Three parts of the YTM video pipeline are each independently welded to "a round".
An ad-hoc set of videos can use none of them:

| Coupling | Where | Consequence |
|---|---|---|
| One review per round, FK to `rounds` | `ytm_video_reviews.round_id INTEGER PRIMARY KEY REFERENCES rounds(id)` (`videoReview.ts:94`) | An ad-hoc set must squat a real round id. FK enforcement is **ON** (`ui/src/lib/db/client.ts:13`), so a synthetic id is rejected outright. |
| Approval always posts to WhatsApp | `completeApproval` (`ui/src/lib/ytm/send.ts:117-135`) does `sendText` + `sendMedia` to `review.target`, unconditionally | Parking an experimental set arms a one-tap ntfy path to posting it to a real group. |
| ~~Cover needs a round + album art~~ | ~~`scripts/ytm-cover/generate.mjs`~~ | **CORRECTED 2026-09-10:** this applies only to the *audio drop* cover. The **music-video** cover is `ui/src/lib/ytm/videoCover.ts`, a different object — a pure typographic title card. Its `VideoCoverInput.picks` field is **declared and never read**, and `renderVideoCover`'s `roundId` argument is used *only* to build a default output path (overridable via `deps.outPath`). It is already roundless-capable with zero changes — verified by rendering one. |

The review UI itself (`/ytm/[roundId]/videos`) is genuinely the right tool — per-song
candidate lists, primary + child videos, manual add via search, include/exclude. Only
its addressing and its side-effects are wrong for this use.

**Goal:** the same HiL screen can confirm an arbitrary named set of videos, build a
playlist on approval, and post **nothing** unless explicitly configured to.

---

## 2. Approaches considered

**A. Separate `ytm_adhoc_reviews` table + separate route.**
Zero risk to the round flow, but duplicates the status machine — precisely the drift
the park endpoint's own comment warns about ("duplicating the table schema and the
status machine out there is exactly the kind of drift the config twin already costs
us"). Two lifecycles to keep in step forever. **Rejected.**

**C. Keep `round_id` as PK, allow synthetic ids, add a send flag.**
Smallest diff, but FK enforcement blocks it and synthetic round ids are a lie that
every future reader has to decode. **Rejected.**

**B. Generalise the key on the existing table. ← recommended**
One table, one status machine, one UI. Costs a SQLite table rebuild (the PK and a
NOT NULL both change), but the table holds **2 rows** today, so the migration is cheap
and verifiable.

---

## 3. Design

### 3.1 Schema

Rebuild `ytm_video_reviews`:

| Column | Change | Why |
|---|---|---|
| `review_key TEXT PRIMARY KEY` | **new PK** | Addresses any review. Rounds use `round-<id>`; ad-hoc uses a caller-supplied slug. |
| `round_id INTEGER NULL REFERENCES rounds(id)` | was PK, now nullable | Still FK-checked when present; null for ad-hoc. `UNIQUE` index where not null. |
| `kind TEXT NOT NULL DEFAULT 'round'` | new | `'round' \| 'adhoc'`. |
| `title TEXT` | new | Display name for ad-hoc. Rounds keep deriving from `reviewContext`. |
| `send_mode TEXT NOT NULL` | new | `'post'` = today's behaviour. `'none'` = build the playlist, send nothing. **No column default** — every writer states it, so the value is never inherited by accident (see §3.2). Migrated round rows are written as `'post'` explicitly. |
| `target TEXT` | was NOT NULL, now nullable | An ad-hoc `send_mode='none'` review has no recipient. |

Migration runs inside `ensureVideoReviewSchema`, guarded on the absence of
`review_key`: create new table, `INSERT … SELECT` with
`review_key = 'round-' || round_id`, `kind='round'`, `send_mode='post'`, drop, rename.
Wrapped in a transaction with `foreign_keys=OFF` for the rebuild (the pattern already
used at `client.ts:74-92`).

### 3.2 Invariant — the send guard is fail-closed

`send_mode='post'` **requires** a non-null `target`; the park endpoint rejects the
combination otherwise (400).

The column carries **no SQL default**, so a value is never inherited silently. The
resolution happens in one place, the park endpoint:
`kind='round'` with no explicit `sendMode` → `'post'` (today's behaviour, preserved);
`kind='adhoc'` with no explicit `sendMode` → `'none'`.
A new ad-hoc review therefore cannot post by omission — only by someone explicitly
passing `"post"` *and* a target.

### 3.3 Code changes

1. **`ui/src/lib/ytm/videoReview.ts`** — accessors keyed by `reviewKey`; add
   `roundKey(roundId) => \`round-${roundId}\`` and keep a thin
   `getReviewByRound(db, roundId)` for the drop path. `UpsertReviewInput` gains
   `reviewKey`, `kind`, `title`, `sendMode`; `roundId`/`target` become optional.
   *(impact: LOW — 1 caller, the park endpoint)*
2. **`ui/src/lib/ytm/send.ts`** — `completeApproval(db, reviewKey, deps)`. After the
   playlist is built, `if (review.sendMode === 'none') { markSent(...); return }`
   before any `sendText`/`sendMedia`. The `'post'` path is byte-for-byte today's.
   *(impact: LOW — 2 callers, the approve and `[roundId]` endpoints)*
3. **`ui/src/lib/ytm/reviewContext.ts`** — for `kind='adhoc'` return
   `{ roundName: review.title, leagueTitle: 'Music League', roundNumber: null }`
   instead of querying `rounds`.
4. **Routes** — `/ytm/[roundId]/videos` keeps working, resolving `round-<id>`
   (no UX change, no bookmark breakage). Add `/ytm/review/[reviewKey]/videos` as the
   general surface; the `[roundId]` page becomes a thin redirect to it.
5. **API** — `park` accepts an ad-hoc payload
   (`{reviewKey, kind:'adhoc', title, sendMode, picks}`). `approve`/`deny`/`snooze`
   are already token-addressed; `claimApproval` returns `reviewKey` rather than
   `roundId`.
6. **Ad-hoc picks** — `spotifyUri: ''` and `band: 'certain'` for an explicitly chosen
   video, `'review'` for an inferred one. No change to `VideoPick`'s shape.

### 3.4 Out of scope (Phase 2)

The **audio-drop** cover (`scripts/ytm-cover/generate.mjs`). Making *that* one roundless
needs its own arg contract (`--title`, `--league`, a songs source that isn't
`ml_submissions`) plus album art. The **music-video** cover needs no work — see the
correction in §1.

**Separate defect found while verifying the above:** the runtime badge in
`videoCover.ts:146` is the hardcoded string `120 MIN`. It is not derived from any data,
so every music-video cover ever posted has claimed 120 minutes — including round 143's,
sent to the real Second Best group on 2026-09-10. Tracked separately; not part of this
design.

---

## 4. Testing

Existing `tests/ytmSend.test.ts`, `tests/ytmVideoReview.test.ts` and
`tests/videoPlaylistStore.test.ts` must pass unchanged in behaviour — they are the
regression net for the round path.

New tests, each written so a wrong implementation fails:

1. **Migration** — seed a pre-migration table with 2 round rows, run
   `ensureVideoReviewSchema`, assert both survive with `review_key='round-<id>'`,
   `kind='round'`, `send_mode='post'`, and that their tokens are unchanged.
2. **`send_mode='none'` sends nothing** — approve an ad-hoc review with a spy
   `fetchFn`; assert the playlist WAS created and `sendText`/`sendMedia` were **not**
   called. The same fixture with `send_mode='post'` must call them — otherwise the
   test cannot tell a working guard from a broken sender.
3. **Fail-closed park** — `{kind:'adhoc', sendMode:'post', target:null}` → 400.
4. **Ad-hoc default** — park an ad-hoc review with no `sendMode`; assert it stored
   `'none'`.
5. **Round back-compat** — park via the existing round payload; assert
   `/ytm/<roundId>/videos` still loads it.

---

## 5. Risks

- **Live-table rebuild.** 2 rows, both `status='sent'` (terminal), so even total loss
  would cost nothing operationally — but back up `data/league.db` before the first run
  regardless, since this repo currently has **no off-box backup** (see incident
  `2026-09-10-travel-host-outage`, A8).
- **Token continuity.** The rebuild must preserve `token`, or an outstanding ntfy
  approval button silently stops working. Covered by test 1.
- **The `[roundId]` API route** is used by the drop script on the host; its payload
  must not change in Phase 1.
