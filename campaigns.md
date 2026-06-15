---
id: music-league-bot-mvp
title: Music League Bot MVP
kind: mvp
signedOff: true
sprints:
  - sprint-1
  - sprint-2
  - sprint-3
  - sprint-4
  - sprint-5
  - sprint-8
  - sprint-9-digest-preview
  - sprint-10-extension-ingest
  - sprint-11-export-import-and-rating-polish
  - sprint-12-remediation-ml-login-data-digest
  - sprint-14-digest-improvements
  - sprint-15-digest-hotfix
  - sprint-16-standings-players
  - sprint-17-digest-visuals
  - sprint-18-tastemaker-v2
  - sprint-19-deploy-and-mobile
  - sprint-20-html-share
  - sprint-21-season-recap
  - sprint-22-history-foundation
  - sprint-23-history-songsearch
  - sprint-24
---
id: post-mvp-features
title: Post-MVP Features
kind: regular
signedOff: false
sprints: []
---
id: the-b-side
title: the b-side — Shareable League Dashboard
kind: regular
signedOff: true
status: complete
completed: 2026-06-15
followOn: the-b-side-polish
roadmapItem: the-b-side-league-dashboard
sprints:
  - sprint-31
  - sprint-32
  - sprint-33
summary: >-
  Public per-league micro-site on digest.mattmariani.com — the fan-facing flip
  side of the operator app. sprint-31 builds the read-model generator (the
  unbuilt content layer: superlatives, KPIs, season moments, biggest fan /
  friendly hater, discovery playlist, member tiers, overlap v2 — on the
  sprint-28 prediction harness); sprint-32 the public 3-route site
  (docs/design/dashboard/); sprint-33 the operator Content screen
  (docs/design/content/). Universal Share button follows as a separate capstone.
sprintPlan:
  - sprint: sprint-31
    title: Read-model generator + foundation
    goal: >-
      Generate the full per-league read-model offline — schema + unguessable
      slug, superlatives / KPIs / moments / fan-hater / playlist / tiers /
      overlap-v2, and first-publish. The make-or-break creative work; no UI yet.
  - sprint: sprint-32
    title: Public b-side site
    goal: >-
      The three public routes (League Home / Player Profile / Digest Archive),
      static-generated on publish and hosted on digest.mattmariani.com.
  - sprint: sprint-33
    title: Operator Content screen
    goal: >-
      Digest → Content tabs, the archive list, the refresh/hold/lock update
      modal, and the reshare card.
---
id: the-b-side-polish
title: the b-side — Polish & Depth
kind: regular
signedOff: false
status: proposed
followsFrom: the-b-side
sprints: []
summary: >-
  Follow-on to the shipped `the-b-side` campaign — turns the owner UAT
  (wiki/.../sessions/testing/2026-06-15-the-b-side-campaign-review.md) plus orc
  proposals into depth and polish. 20 roadmap cards tagged `campaign:
  the-b-side-polish` (12 `source: owner-uat`, 8 `source: orc-proposal`). The b-side
  shipped and is owner-ratified; nothing here is a release blocker. The proposed
  sprint shape below is a STARTING POINT for prioritization, not locked — sprint
  membership gets ratified before kickoff.
proposedSprints:
  - title: Polish-1 — Season & data truth (foundation)
    rationale: >-
      The load-bearing slice everything content-related depends on. Cards:
      bside-season-round-truth, bside-season-lens, bside-read-model-provenance,
      bside-degenerate-state-handling, bside-age-field-save-bug. Heavy overlap with
      the existing `active-league-management` roadmap card — sequence them together.
  - title: Polish-2 — Superlatives & voice
    rationale: >-
      The content engine. Cards: bside-superlatives-curation (count control +
      generate-N-pick-M + adjective-variation), bside-superlative-visual-identity,
      bside-semantic-accent-system, bside-voice-snark-tuning.
  - title: Polish-3 — Visual & mobile
    rationale: >-
      Cards: bside-mobile-card-rows (fade/carousel), bside-member-grid-richness,
      bside-share-card-og-meta, bside-returning-visitor-diff.
  - title: Polish-4 — Metrics correctness & operator QA
    rationale: >-
      Cards: bside-fan-hater-overlap-normalization (averages), bside-real-audio-fingerprint,
      bside-update-diff-preview, bside-content-lint.
  - title: Polish-5 — Avatars (themed LLM batches)
    rationale: >-
      Stands alone (large). Card: bside-llm-avatars. Needs the per-player base
      image/description groundwork.
  - title: Polish-6 — Moments & the real playlist
    rationale: >-
      Cards: bside-moments-chat-mined (+ editor pass), bside-discovery-playlist-link,
      bside-playlist-audio-integration.
