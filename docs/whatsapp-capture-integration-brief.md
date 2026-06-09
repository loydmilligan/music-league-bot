# WhatsApp Group-Chat Capture — Architecture Brief for an External Solution

**Audience:** an LLM/assistant helping design a **standalone WhatsApp group-chat
capture addon** for our app. This document gives you everything you need about
our app's architecture and the integration surface, so your proposed solution
*fits* — without inheriting our current (unreliable) capture code.

> **Important framing:** We already have a WhatsApp integration
> (`whatsapp-web.js`), and **we are intentionally setting it aside.** Do **not**
> design around it, extend it, or assume any of its behavior. Treat capture as a
> **greenfield component**. We describe it only so you know the landscape — see
> "What we're replacing" below.

---

## 1. What we're asking you to design

A reliable way to **capture the recent message history of a specific WhatsApp
group chat, on demand**, and hand it to our app. Scoped to this UX:

1. In our app's **Settings** page, the user selects **which WhatsApp group** to
   capture (one group at a time is fine for v1).
2. The user presses a **button** ("Fetch latest chat history" or similar).
3. Your solution returns an **up-to-date transcript** of that group's recent
   messages, which our app stores and later feeds into a feature (see §5).

That's the whole scope of *your* part. **You do not need to integrate the
captured content into our downstream feature** — that's already built on our
side and we'll wire your output into it ourselves (the consumption works; only
the *capture* is unreliable today). Your job: **select a group + reliably fetch
its recent history**, delivered in the shape described in §6.

The crux — and where our current approach fails — is **WhatsApp authentication /
session reliability** and **selecting the right group among many**. Please center
your design on solving those.

---

## 2. What the app is (context)

**music-league-bot** is a companion tool for *Music League* (a song-submission +
voting game played in seasons of rounds). Among other things, it generates a
**"digest"** — a stylized recap of each round (who won, vote drama, etc.). One
section of the digest summarizes the **group-chat banter** around that round.
That chat content comes from the league's WhatsApp group. **Getting that chat
text reliably is the problem you're solving.**

There is **one WhatsApp group per league**, and the user runs **multiple
leagues**, so group selection matters.

---

## 3. Tech stack & runtime environment (the host your solution must fit)

| Layer | Tech |
|---|---|
| Web app / UI | **SvelteKit** (Svelte 5), TypeScript — server routes are `+server.ts` files |
| Backend logic | **Node.js (v22)**, TypeScript |
| Data store | **SQLite** (a single file under a mounted `data/` volume; `better-sqlite3`) |
| Packaging | **Docker Compose**, multiple services (see below) |
| Host | A **Linux** box (Debian-based); the app is reached at a LAN address and over a Cloudflare tunnel. Deploys are `docker compose build --no-cache <svc> && docker compose up -d --force-recreate <svc>`. |
| LLM | Digest text is generated via **OpenRouter**. |

**Docker Compose services** (one repo):
- `bot` — the Node backend / WhatsApp-bot process (this is where the *legacy*
  whatsapp-web.js client runs today; headless Chromium via Puppeteer).
- `api` — a Node API process (port 3001).
- `bot-ui` — the **SvelteKit app** (the user-facing UI + its `+server.ts` API
  routes; port 3002). **This is where Settings lives.**
- `bracket` — an unrelated sibling app; ignore.

Everything shares the same `data/` directory (the SQLite DB + assorted files)
via a Docker volume mount. **A new capture component can run as its own
container/service in this compose stack, or as a host-side helper process** —
your call. It needs to be reachable by the SvelteKit app (an HTTP call from a
`+server.ts` route is the natural trigger) and able to deliver its output where
the app can read it (HTTP response and/or the shared SQLite DB / `data/` dir).

---

## 4. What we're replacing (so you don't repeat it)

Today: `src/whatsapp/client.ts` uses **`whatsapp-web.js`** with `LocalAuth`
(a persisted Chromium profile under `.wwebjs_auth/`), running headless in the
`bot` container. It listens to group messages live and forwards candidates.

**Why it's unreliable for our purpose:**
- The auth session needs **frequent re-authentication** (QR re-link), and it's
  not robust/hands-off.
- It's **live-listener** oriented (it reacts to messages as they arrive), not
  **"give me the last N messages / the last week on demand"**, which is what the
  digest needs.
- Group selection / multi-group handling was never cleaned up.

**You are free to choose a completely different mechanism** (different library,
WhatsApp Business/Cloud API, a userland multi-device approach, a self-hosted
bridge, manual-export ingestion, etc.). We have **no constraint** other than
"fits the runtime in §3 and produces §6." Please weigh auth durability, ToS/risk,
and operational simplicity in your recommendation, and state the tradeoffs.

---

## 5. Where it plugs in (UI + data path)

**UI — Settings.** Our Settings page is a SvelteKit route
(`ui/src/routes/settings/+page.svelte`) made of card "sections" (e.g. rating
weights, ZIP import, API-tokens link). We'll add a **"WhatsApp capture" section**
here: a **group selector** + a **"Fetch latest history" button**. The button
calls a SvelteKit server route (`+server.ts`) which triggers your capture
component and stores the result.

**Group selection.** Ideally your component can **list the user's available
groups** (so the UI shows a dropdown to pick from) and remember the selected
group. If listing groups isn't feasible in your approach, tell us how the user
should otherwise identify the target group (e.g. paste a group name/id).

**Data path / downstream (already built — FYI only).** The captured transcript
feeds our digest's "chat section." Our digest generator **already accepts a
pasted chat transcript** as that section's source (there's a manual
"paste WhatsApp chat" box today that works) — so if your output matches that
transcript shape (§6), wiring it in is trivial on our side. We'll handle that
wiring; you don't need to.

---

## 6. Output contract (what to hand us)

Deliver a **transcript of the group's recent messages**, scoped to a group and a
time window (the digest cares about the messages around a round — typically the
last ~1–2 weeks, but "last N messages" or "since timestamp" is fine; let us pass
a window).

Minimum per message:
- **sender** (display name; phone/id optional)
- **timestamp** (ISO 8601 preferred)
- **text** (message body; system messages and media can be omitted or noted)

Acceptable delivery shapes (your choice — note which you'd produce):
- **Structured JSON** array of `{ sender, timestamp, text }` (preferred — most
  flexible), and/or
- **A plain-text transcript** (e.g. `[2026-06-01 14:03] Alice: message…` lines)
  — this matches our existing paste-box format and is a drop-in.

We'll persist it keyed by group + capture time. (Our DB already has chat tables;
exact storage is our problem — just get us the transcript.)

---

## 7. Constraints & non-goals

- **Fits §3's runtime** (Linux/Docker/Node/SvelteKit/SQLite). A separate
  service or host helper is fine; it must be callable from a SvelteKit
  `+server.ts` route and deliver §6.
- **Reliability of auth/session is the #1 goal** — minimize re-auth friction;
  ideally a one-time setup then hands-off.
- **On-demand fetch**, not a persistent live listener (we pull when the user
  clicks).
- **One group at a time** is acceptable for v1; multi-group is a nice-to-have.
- **Non-goals (we handle these):** integrating the transcript into the digest,
  the digest UI, summarization. Don't design those.

---

## 8. Please address in your proposal

1. **Capture mechanism** — which approach/library, and **why** (auth durability,
   ToS/account-risk, maintenance). Compare 1–2 alternatives if relevant.
2. **Authentication & session** — how the user authenticates once, how the
   session persists, and what re-auth (if any) looks like over time. This is the
   make-or-break vs. our current setup.
3. **Group selection** — can you enumerate the user's groups for a dropdown? If
   not, how does the user specify the target?
4. **History fetch** — how you pull recent history on demand (last N / since
   timestamp / date range), and any pagination/rate limits.
5. **Packaging** — how it runs in our stack (own Docker service? host helper?)
   and how the SvelteKit app triggers it (HTTP endpoint? CLI? shared file?).
6. **Output** — confirm the §6 shape you'd produce.
7. **Risks / limitations** — ToS, ban risk, multi-device caveats, rate limits,
   anything operational we should know.

---

*Generated for music-league-bot. The app owner will handle storage + downstream
digest wiring; your deliverable is reliable on-demand group-chat capture per the
above.*
