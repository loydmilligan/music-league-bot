# WhatsApp / Chat Feature Map — music-league-bot

> Synthesized from four parallel code maps (CAPTURE, DATA, CONSUMPTION, UI/WORKFLOWS).
> Every claim is grounded in those maps with `file:line` citations preserved.
> Claims marked **[INFERRED]** are not directly evidenced in code; **[EVIDENCED]** is
> the default and only called out where a contrast matters.

---

## 1. Overview

The WhatsApp/chat integration ("Chat watcher") is a bot that listens to allow-listed
WhatsApp group chats, detects music links (Spotify / YouTube / Apple Music) shared in
conversation, resolves them to Spotify tracks, and persists them — along with who said
it and the surrounding message context — as actionable song *candidates* distinct from
the official Music League round submissions. The captured songs surface in a `/chat`
triage UI where the user can rate, assign-to-round, shortlist, or dismiss them, and they
also feed an optional "chat" narrative section of each round's digest/recap. It is a
personal, single-league tool (sender and group names are hardcoded), not multi-tenant.

---

## 2. How it functions (mechanism) — end-to-end data flow

### Capture (WhatsApp → bot)

- **Library:** `whatsapp-web.js` (Puppeteer-driven WhatsApp Web automation), loaded via a
  CommonJS `createRequire` shim — `src/whatsapp/client.ts:1-6`. README mentioned Baileys
  as an alternative; the shipped choice is whatsapp-web.js (`src/whatsapp/README.md:5-8`).
- **Auth:** QR code printed to the terminal on the `qr` event via `qrcode-terminal`
  (`client.ts:27-30`), with `LocalAuth` persisting the session to disk. Docker mounts
  `./.wwebjs_auth` and `./.wwebjs_cache` as volumes so sessions survive rebuilds
  (`docker-compose.yml` bot `volumes:`). Chromium is installed in-image with
  `CHROMIUM_PATH=/usr/bin/chromium` (`Dockerfile:3-9`), launched with container-hardening
  flags `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` (`client.ts:21`).
- **Listener model:** live event listener `client.on('message_create', ...)`
  (`client.ts:39`) — note this fires for **all** messages including the bot's own
  outgoing ones (vs. the `message` event which is incoming-only). Capture listens to every
  chat; the only gate is a downstream group allow-list in the handler
  (`handler.ts:39`, from `WHATSAPP_ALLOWED_GROUP_IDS`, `index.ts:17-20`).
- **Context buffer:** a per-chat ring buffer of the last 5 messages
  (`BUFFER_SIZE = 5`, `client.ts:9-18`); the prior 3 are attached as `priorMessages` on
  each captured message (`client.ts:43`, sliced `-3`). Each is `{sender, timeMs, text}`.
- **Wiring:** `src/index.ts:31-44` builds the client with the `handleMessage` callback and
  calls `client.initialize()`.

### Routing (handler, two branches)

Capture wraps the raw message into a `WhatsAppMessage` (`handler.ts:14-24`:
`body, from, chatName, author, fromMe, capturedAt, priorMessages, reply(), getContact()`)
and calls `handleMessage` (`handler.ts:36`):

- **Path A — explicit `!song` command** (`handler.ts:44-167`): `parseMessage(body)` →
  resolve submitter name → `resolveTrack(...)`. Handles `not-found` / `low-confidence`
  notifications, then `applyRules()` (`handler.ts:108`) maps the track to target
  playlists, dedupes, adds it, replies to the group, and writes `insertSubmission(...)`
  with a status of `added`/`duplicate`/`no-rule`/`not-found`. **Path A does NOT write the
  chat tables** (`insertChatCapture` is called only from Path B — see DATA map).
- **Path B — auto-capture** (when `parseMessage` returns null, `handler.ts:46-52`):
  `detectMusicUrls(body)` regex-scans for Spotify/YouTube/Apple Music URLs
  (`urlDetector.ts:8-40`). Each URL → `handleAutoCapture` (`handler.ts:170`). Non-Spotify
  URLs go through `songlinkLimiter.acquire()` + `resolveSonglinkUrl` to cross-resolve to
  Spotify (`handler.ts:184-256`); Spotify URLs resolve directly (`handler.ts:258-313`).
  Both add the track to the **master playlist** (`MASTER_PLAYLIST_NAME`) and write **two**
  stores: `insertSubmission(db, ...)` **and** `insertChatCapture(...)`
  (`handler.ts:238`, `:296`).

### Storage (the chat data model)

Single ingestion point `insertChatCapture()` (`src/storage/chatDb.ts:88-123`) writes a
3-table satellite model in the same `league.db` as the core ML tables. DDL is declared in
two hand-synced places: the bot's `src/storage/chatDb.ts:16-33` and the canonical UI
schema `ui/src/lib/db/schema.ts:107-136` (the bot copy omits two indexes).

- **`chat_songs`** (`schema.ts:107-118`): de-duplicated catalog, one row per Spotify
  track. Dedup key `spotify_uri TEXT NOT NULL UNIQUE`; carries metadata
  (artist/title/album/year/duration/art), a `dismissed` flag, and `first_seen_at`.
  Upsert by `spotify_uri` (`chatDb.ts:92-102`) — a repeat mention reuses the existing row.
- **`chat_mentions`** (`schema.ts:119-128`): one row per individual occurrence (the many
  side). FK `song_id → chat_songs(id) ON DELETE CASCADE`, plus `chat_name`, `sender_name`,
  `captured_at` (ISO; load-bearing for round assignment + ordering), `raw_message`,
  `prior_messages` (JSON `[{sender,timeMs,text}]`), and `intent`. Always INSERTs fresh
  (`chatDb.ts:107-111`).
- **`chat_assignments`** (`schema.ts:129-134`): join table to ML rounds. Composite PK
  `(chat_song_id, round_id)` = idempotent. FKs cascade from both `chat_songs` and `rounds`.

**Intent classification** (`src/bot/intentClassifier.ts:39-46`, called `chatDb.ts:104-105`):
a keyword/phrase substring matcher (not ML) over lowercased `raw_message` + the last prior
message. Types `'alt' | 'retro' | 'found' | 'maybe' | 'unclassified'`
(`intentClassifier.ts:1`), priority-ordered `['alt','retro','maybe','found']`
(`intentClassifier.ts:37`); first phrase hit wins, else `'unclassified'`.

**Auto-assignment** (`autoAssignRoundId`, `chatDb.ts:42-71`): (a) if `captured_at` falls
strictly after a round's `submission_deadline` and at/before its `voting_deadline`, assign
to that round; (b) else if within 2h after the most recent round's `voting_deadline`,
assign to that round; (c) else no assignment (song stays in the "unassigned" queue). On
assignment, the song is also `INSERT OR IGNORE`'d into `research_songs(round_id,
spotify_uri, ...)` (`chatDb.ts:117-121`) — the bridge into the research/shortlist pipeline.

### Consumption (readers)

- **`/chat` triage page** — lists chat songs with context for per-song actions.
- **Digest "chat" section** — narrates round-assigned mentions in the recap.
- **Digest prep readiness check** — counts captured mentions before generation.

(Detailed in §3–§4 below.)

---

## 3. User-feature inventory

| Feature | What the user does | What it produces | Status / reliability |
|---|---|---|---|
| **Auto-capture of shared links** (`handler.ts:46-52,170`; `urlDetector.ts:8-40`) | Nothing — a group member posts a Spotify/YouTube/Apple Music link in an allow-listed chat | A resolved Spotify track added to the master playlist + a `chat_songs`/`chat_mentions` row | **Risky.** Auto-capture failures are **silent** (console log only, no group reply — `handler.ts:252-254,310-313`); captures can be lost with no in-chat signal. Non-Spotify resolution gated by Songlink rate limiter (`handler.ts:186`). |
| **Explicit `!song` submission** (`handler.ts:44-167`) | Type `!song <query>` in chat | An `ml_submissions` row + group reply (`✅ Added…` / not-found / low-confidence). **Does NOT populate chat tables.** | Evidenced. Distinct from chat capture; included because it shares the WhatsApp capture surface. |
| **Mention context / pull-quotes** (`CwRow.svelte:100-136`; `priorMessages` `client.ts:43`) | Expand a row on `/chat` | Per-mention timeline: who said it, prior messages, quoted body, time, intent badge | Evidenced. Depends on `prior_messages` JSON captured at ingest. |
| **Intent tagging** (`intentClassifier.ts`; badge `CwRow.svelte`) | Nothing — assigned at capture | ALT / RETRO / FOUND / MAYBE / unclassified badge | Evidenced, but a crude substring matcher; **[INFERRED]** low accuracy on natural phrasing. Not read by the digest. |
| **Filter & sort** (`CwFilterBar.svelte:30-64`) | Toggle All/Unassigned/Assigned, per-chat-name chips, sort recent/mentioned | Filtered list; filters persist to URL (`+page.svelte:15-22`) | Evidenced. Per-chat-name chips and color tones are **hardcoded** to specific names (`CwRow.svelte:17-22`, `CwFilterBar.svelte:46`). |
| **Nav badge** (`+layout.svelte:17,21`) | Glance at nav | Count of unassigned, not-dismissed chat songs | Evidenced. |
| **Assign to round** (`assign/+server.ts:6-11`; `chat.ts:176-185`) | Click ⊕ / AssignPopover | `chat_assignments` row + mirror into `research_songs`; `→ R-{id}` chip | Evidenced. Manual equivalent of bot auto-assign. Unassign via `DELETE …/assign/[roundId]`. |
| **Shortlist (Bookmark)** (`shortlist/+server.ts:7-25`) | Click Bookmark | Track copied into `shortlist_songs` | Evidenced. Manual only — no auto path. |
| **Dismiss / Restore** (`dismiss/+server.ts:6-14`; `setChatSongDismissed` `chat.ts:172`) | Two-click "Not interested" / Restore | Toggles `dismissed`; hides from default lists | Evidenced. |
| **Play on Spotify** (`CwRow.svelte:141-148`) | Click | External Spotify link | Evidenced. |
| **Digest chat section (auto)** (`llm.ts:118-126,246-251,294-299`) | Generate a round digest | LLM `{summary, moments[]}` from round-assigned mentions, rendered by `ChatMoments.svelte` | Evidenced. Gated on `hasChat` (mentions exist or pasted chat). Web=accordion; export=anchor TOC (`ChatMoments.svelte:49,64-86`). |
| **Digest chat section (pasted override)** (`GenerateModal.svelte:162-167`; `draft/+server.ts:126-148`; `llm.ts:301-307`) | Paste raw WhatsApp chat into the Generate modal | Chat section sourced from the paste; **ignores auto-captured mentions** for that section | Evidenced. Exists explicitly because auto-capture is flaky (comment `llm.ts:301-302`). |
| **Digest prep readiness** (`prepChecks.ts:67-96`) | Open digest prep screen | "Chat-window mentions" row: count + captured date range `watcher · {min}→{max}` | Evidenced. Marked `optional: true`. |
| **Bearer-token management** (`settings/api-tokens/+page.svelte:64-68`) | Generate/revoke tokens for the browser extension / clients posting to `/api/ingest/*` | SHA-256-stored tokens (shown plaintext once) | Evidenced. **Note:** `/api/ingest/songs` writes to the **shortlist**, not chat tables (`ingest/songs/+server.ts:38-44`). |

---

## 4. Designed workflows

**W1 — Automatic capture (bot side).** A group member posts a music link in an
allow-listed WhatsApp chat → bot's per-chat ring buffer snapshots the 3 prior messages
(`client.ts:43`) → Path B `handleAutoCapture` resolves the URL to a Spotify track
(directly, or via Songlink for non-Spotify) → adds to the master playlist → writes
`insertSubmission` **and** `insertChatCapture`, which upserts `chat_songs`, inserts a
`chat_mention` (with prior messages + classified intent), and **auto-assigns** to the
round whose voting window the message falls in (or a round that closed <2h ago), also
seeding `research_songs` (`chatDb.ts:88-123`).

**W2 — Triage chat songs.** User opens "Chat watcher" (nav badge shows unassigned count) →
filters by status / chat-name and sorts by recent or mention-count → expands a row → reads
the pull-quote context (who said it, what came before, intent) → decides per song: Assign
to round, Bookmark to shortlist, or "Not interested" (two-click dismiss). Manual assign
also seeds `research_songs`.

**W3 — Manual assign / unassign.** Expand row (or inline ⊕) → AssignPopover → pick round →
`POST …/assign` → `→ R-{id}` chip appears. Remove via popover → `DELETE …/assign/{roundId}`.

**W4 — Digest chat highlights.** When a digest is prepared/generated, the LLM pulls
`chat_mentions` joined to that round's `chat_assignments` (`llm.ts:118-126`) → optionally
the user pastes raw chat to override (`GenerateModal.svelte:162-167`) → LLM produces
`{summary, moments[]}` → rendered by `ChatMoments.svelte` in the digest preview (accordion)
and in PNG/PDF exports (anchor-linked).

**W5 — One-time setup.** Generate a bearer token at `/settings/api-tokens` and load it into
the browser extension / client → it POSTs to `/api/ingest/*`. Separately, the WhatsApp bot
must be running and QR-authed, round deadlines must be set (auto-assign keys off
`submission_deadline`/`voting_deadline`), and OpenRouter must be configured for the digest
chat-section LLM (`llm.ts:7`). **[FLAGGED]** there is no in-UI surface to configure or
monitor the WhatsApp connection itself — setup is entirely bot-side.

---

## 5. User stories

**Explicit in plan/code** (canonical source: `docs/superpowers/plans/2026-05-17-chat-watcher.md`):

- **US1 (capture):** As a Music League player, I want songs my friends share in our
  WhatsApp group chats auto-captured, so that I don't lose good candidates buried in chat.
  — plan Goal; page subtitle; empty-state copy (`+page.svelte:66-68`).
- **US2 (context):** As a player, I want to see who shared a song, what they said, and the
  surrounding messages, so that I can judge whether it's worth using. — pull-quote +
  `priorMessages` (`CwRow.svelte:100-136`).
- **US3 (intent triage):** As a player, I want shared songs tagged by intent
  (alt/retro/found/maybe), so that I can tell a serious suggestion from idle chatter.
  — intent classifier (`intentClassifier.ts`).
- **US4 (round routing):** As a commissioner, I want chat songs auto-routed to the round
  active when they were shared, so that they land in the right research bucket without
  manual sorting. — `autoAssignRoundId` + `research_songs` write.
- **US5 (actioning):** As a player, I want to assign/shortlist/dismiss each chat song, so
  that my chat candidates flow into my existing shortlist and per-round research.
  — page subtitle "Rate, assign, or shortlist"; action buttons.
- **US6 (digest narrative):** As a commissioner, I want the funny/notable chat moments
  tied to a round summarized in the digest, so that the recap captures the group's banter.
  — LLM prompt voice (`llm.ts:208`).
- **US7 (setup/auth):** As the operator, I want to issue revocable bearer tokens, so that
  the extension/bot can ingest securely. — api-tokens page copy.

**Inferred (not stated as a story, derived from code):**

- **[INFERRED]** "I want repeatedly-shared songs to surface first, because repeated
  mentions = stronger group interest." — the "mentioned" sort + `N×` mention count exist
  (`CwFilterBar.svelte:57-64`) but the rationale is undocumented.
- **[INFERRED]** Single-deployment/personal tool — sender and chat color-tone maps are
  hardcoded to specific names (`CwRow.svelte:17-22`, `CwFilterBar.svelte:46`), implying a
  personalization shortcut rather than an intended config surface.

---

## 6. Gaps, ambiguities & reliability risks

This is the open question the maps were assembled to answer: **do these features cover our
needs?** The capture layer's unreliability is the dominant risk, and the codebase already
contains an explicit workaround (pasted-chat override) that confirms the team does not
trust auto-capture.

### Capture-unreliability directly undermining features

1. **Silent auto-capture failures (highest risk).** Path B swallows resolution errors with
   only a console log and **no in-chat feedback** (`handler.ts:252-254,310-313`). A song
   can fail to capture with zero signal to anyone. This directly undermines **US1** (the
   core promise) and **US6** — if mentions silently never land, the digest chat section is
   empty or wrong. The pasted-chat override (`llm.ts:301-307`, `GenerateModal.svelte`) is
   an explicit acknowledgement in code that auto-capture is "flaky."
2. **Hard crash on disconnect, no in-process reconnect.** `client.on('disconnected')` calls
   `process.exit(1)` (`client.ts:34-37`); recovery relies entirely on docker-compose
   `restart: unless-stopped`. Any WhatsApp Web drop = full restart + Puppeteer relaunch,
   during which **all messages are missed** (live listener, not on-demand backfill — there
   is no catch-up of messages sent while disconnected). This silently erodes US1/US4/US6.
3. **Singleton-lock workaround on every boot.** The container CMD force-deletes Chromium
   `Singleton*` files before start (`Dockerfile:18`) to dodge "profile in use" failures
   after unclean exits — a known whatsapp-web.js/Puppeteer fragility being papered over.
4. **`@lid` (Multi-Device) contacts may not resolve.** `getContact()` falls back to the raw
   author ID (`handler.ts:58-60,182`); `getChat()` similarly falls back to the raw chatId
   (`client.ts:51-55`). Degrades the attribution that **US2** depends on.
5. **Songlink rate-limiting.** Non-Spotify resolution is gated by `songlinkLimiter.acquire()`
   (`handler.ts:186`), implying an external throttle that can delay or queue captures.

### Designed-intent ambiguities / partial features

6. **Bot's own messages are not ignored.** Capture uses `message_create` (includes outgoing)
   and never filters on `fromMe`, contradicting the README's "Ignore messages from the bot
   itself" (`README.md:15`; `client.ts:60` sets `fromMe` but nothing short-circuits on it).
   The bot's `✅ Added…` replies re-enter capture and are saved by the group allow-list only
   — an unguarded path. **[FLAGGED]** designed intent (ignore self) is unmet.
7. **Auto-assignment depends on deadlines being set.** `autoAssignRoundId` keys off
   `submission_deadline`/`voting_deadline`; if unset, every captured song stays "unassigned"
   and US4 silently no-ops. No warning surfaces this dependency.
8. **No in-UI WhatsApp connection monitoring.** Setup, auth (QR), and health are entirely
   bot-side with no UI surface — the user cannot tell from the app whether capture is even
   alive. This compounds gaps #1 and #2 (a dead watcher looks identical to a quiet chat).
9. **Intent is surfaced but not consumed.** The digest/prep queries do not read `intent`
   (DATA map); it's chat-review-UI-only. The classifier is also a brittle substring matcher.
   **[INFERRED]** US3's value is limited to manual triage and likely noisy.
10. **Hand-synced dual DDL drift.** The chat tables are declared twice (`chatDb.ts` vs.
    `schema.ts`), kept in sync by hand, and the bot copy already omits two indexes — a
    standing schema-drift hazard.
11. **`/api/ingest/songs` naming confusion.** Despite the name, it writes the **shortlist**,
    not chat tables (`ingest/songs/+server.ts:38-44`); the only `chat_mentions` writer is the
    bot's `insertChatCapture`. The bearer-token "extension auth" copy implies an ingest
    surface that does not feed chat capture — an ambiguity for any future extension work.
12. **Hardcoded personalization.** Sender/chat color maps and names are hardcoded
    (`CwRow.svelte:17-22`, `CwFilterBar.svelte:46`) — fine for a personal tool, a blocker for
    any reuse. **[INFERRED]** polish gap, not an intentional config surface.
13. **Capture verification caveat (from UI/WORKFLOWS map).** That map read the bot-side
    capture/classifier/buffer behavior from `2026-05-17-chat-watcher.md`, not always shipped
    source; the CAPTURE and DATA maps corroborate the bot source exists and matches, so this
    is largely resolved, but treat plan-only line references with that caveat.
