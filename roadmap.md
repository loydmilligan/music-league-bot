---
id: digest-auto-schedule
title: Digest Auto-Schedule
stage: planned
effort: small
summary: Auto-post the weekly digest to the WhatsApp group on a configured day/time. The full generation pipeline is built — this is just wiring the existing output to the bot's send path on a cron.
---
id: whatsapp-history-backfill
title: WhatsApp Chat History Backfill
stage: planned
effort: medium
summary: One-time import of exported WhatsApp .txt chat history to backfill all song shares that happened before the bot was installed. chatDb schema is already in place — needs a parser + ingest pipeline.
---
id: submission-integration
title: Submit to Music League from Shortlist
stage: analyzed
effort: small
summary: Add a "submit to ML" action directly from the shortlist or shortlist detail view. ML Auth is already implemented — this closes the research-to-submit loop without leaving the app.
---
id: ytm-resolution
title: YouTube Music Resolution (Headless Queue)
stage: analyzed
effort: medium
summary: Replace the broken Odesli cross-link with a server-managed Playwright/Puppeteer queue for reliable YTM lookup. Unblocks YtmPlayButton and the existing YTM play infrastructure. Quick fallback: music.youtube.com/search?q=Artist+Title links when full resolution fails.
---
id: isrc-deduplication
title: ISRC-Based Strict Deduplication
stage: analyzed
effort: medium
summary: Replace fuzzy title/artist string matching with ISRC lookups against the historical songHistory database. Prevents submitting remasters, live cuts, or re-releases of previously played tracks.
---
id: algorithmic-theme-validation
title: Algorithmic Theme Validation
stage: idea
effort: medium
summary: Automated heuristic validation of submissions against Spotify track metadata (release year, BPM, genre tags, explicit flags). Instantly rejects submissions in WhatsApp if they violate numeric or categorical theme rules (e.g., "Songs over 180 BPM", "Released in 1994").
---
id: rich-media-digests
title: Rich-Media Digests Pushed to WhatsApp
stage: idea
effort: medium
summary: Render digest sections (podiums, standings, biggest upset) as images via a headless browser or HTML-to-image pipeline, then post them directly into the WhatsApp group when a round closes. Eliminates the "leave the app to see the digest" friction.
---
id: audio-previews-in-chat
title: Native Audio Previews in WhatsApp
stage: idea
effort: medium
summary: Fetch 30-second preview buffers from the Spotify Web API and dispatch them as native WhatsApp audio messages. Lets members preview submissions without opening a streaming app.
---
id: voting-bias-analytics
title: Voting Bias Analytics
stage: idea
effort: medium
summary: Track historical voting matrices across seasons — "User A awards 40% of their points to User B." UI dashboard with directed graphs of point distributions. Exposes voting cartels and introduces metagame depth.
---
id: elo-rating-system
title: Elo Rating System
stage: idea
effort: medium
summary: Augment or replace cumulative point tracking with a zero-sum Elo system that updates after every round based on expected vs. actual placement. Normalizes for varying participant counts and lucky rounds.
---
id: bracket-tournament-ui
title: Interactive Bracket Tournament UI
stage: analyzed
effort: large
summary: Full March Madness-style bracket UI on top of the existing tournamentStore and H2H infrastructure. Automates daily WhatsApp polling, advances winners by reaction count, renders live bracket SVGs in the SvelteKit UI.
---
id: cross-season-dna
title: Cross-Season Music DNA View
stage: idea
effort: medium
summary: Personal summary spanning all seasons — submission acceptance rate over time, themes you win at, artists you consistently pick, taste overlap with others. Standalone screen alongside the History tool.
---
id: agnostic-playlist-provisioning
title: Multi-Platform Playlist Provisioning
stage: idea
effort: large
summary: Extend Songlink integration to provision and sync mirrored playlists on Apple Music and Tidal alongside Spotify. Eliminates friction for members who don't use Spotify as their primary platform.
---
id: google-chat-integration
title: Google Chat Integration
stage: idea
effort: large
summary: Mirror the WhatsApp bot functionality in Google Chat — passive URL capture, digest posting, commands. Extends the platform to groups that use Google Workspace instead of WhatsApp.
---
id: mention-list
title: Owner Mention List (DM Queue)
stage: idea
effort: small
summary: Private song queue for the owner — URL drops in DM are appended to a running list; !mention process flushes the queue to a private Spotify playlist. No group noise.
