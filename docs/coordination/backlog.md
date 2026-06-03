---
project: music-league-bot
type: backlog
created: 2026-05-20T00:00:00Z
updated: 2026-05-20T00:00:00Z
---

# music-league-bot — backlog

> Items deferred from active sprints. These are paused, not in flight. When ready to pull, move into `docs/coordination/sprint-N.md` under `## Active Sprint Plan`.

---

## YouTube Music play button alongside Spotify (drafted 2026-05-20) — ✅ PULLED into sprint-13 (2026-06-02)

**Source:** user request 2026-05-20 while wrapping sprint-10. Every song card in the webapp currently has a Spotify play button. We want a parallel YTM play button so the user can listen via whichever service they prefer.

**Problem.** Songs in `shortlist_songs` (and elsewhere) typically have a Spotify URL but no YTM URL (or vice versa for songs ingested via the YTM extension path once that lands). When the user wants to play via YTM but only the Spotify link is cached, today they have nothing to click. We have a Songlink integration that can resolve one to the other.

**Direction.**

1. **DB layer.** `shortlist_songs` (and any other song table — `ml_submissions`, `research_songs`, `chat_songs`) needs a `ytm_url` column if it doesn't already have one. Check the schema first — `ytm_link_cache` and `ytm_resolution_queue` exist; the cache may already handle this. Reuse before adding columns.

2. **Resolution endpoint.** `POST /api/songs/:id/resolve-ytm` (or generic `POST /api/songlink/resolve` that takes a Spotify URL + song id). When called:
   - If `ytm_url` is already populated, return it (idempotent).
   - Else: hit Songlink with the Spotify URL, extract YouTube Music link from the response, persist to `ytm_url` (or to `ytm_link_cache`), return.
   - On failure (no YTM equivalent on Songlink): persist a "no-match" marker so we don't re-call Songlink for the same Spotify URL on every click.

3. **Reverse direction (YTM → Spotify).** Symmetrical — `POST /api/songs/:id/resolve-spotify` when the song was ingested via the YTM extension path and only has `ytm_url`. Reuses the same Songlink call (it returns both directions).

4. **UI affordance.** Wherever the Spotify play button renders, add a YTM play button. Two states:
   - **Resolved:** YTM URL is in the row → button is a direct `<a>` to the YTM URL.
   - **Unresolved:** YTM URL is missing → button triggers the resolve endpoint, shows a small spinner, then re-renders as the resolved direct link (or shows "no YTM match" if Songlink returned no equivalent).
   - Reverse for songs that only have YTM URLs.

5. **Background backfill (optional).** A small worker that periodically scans for rows missing one platform URL and pre-resolves via Songlink, so the UI button is almost always pre-resolved by the time a user clicks. Probably not v1 — start with on-click resolution and add the backfill if the UX needs it.

**Why this matters.** User has a strong YTM preference for some listening contexts; today the only path is to manually search YTM for the song. The Spotify/Songlink/YTM integration is already plumbed for ingest (sprint-10 T9); this is the consumer-side of the same data.

**Open questions.**

- Where does the YTM play button live visually relative to the Spotify button? Stacked, side-by-side, behind a menu? Probably side-by-side, with the unresolved state visually distinguished (faded or with a tiny resolve icon overlay).
- Do we want analytics on resolve attempts? (How many times "no YTM match" comes back per song would inform whether to surface that more prominently or hide the button entirely for un-resolvable songs.)
- The user mentioned this should work bidirectionally — Spotify-only songs should get YTM via resolve, and YTM-only songs should get Spotify via resolve. Confirm Songlink response shape supports both (likely yes — Songlink returns all platforms by default).
- Caching policy: how long is a Songlink result good for? Songlink URLs typically don't change, so persistent cache is fine; only invalidate if a song is re-resolved manually by an operator.

**Pairs with:** Sprint-10 T9 (YTM Songlink backend ingest path — already shipped, has the deferred debug bug; that debug informs the same code path this feature uses).
