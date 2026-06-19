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
signedOff: true
status: complete
sprints:
  - sprint-25
  - sprint-26
  - sprint-27
  - sprint-28
  - sprint-29
  - sprint-30
  - sprint-34
  - sprint-35
summary: >-
  The standalone post-MVP sprints that shipped before work moved into named themed
  campaigns. sprint-25 live round import + active-round picker (active-league-management,
  v1.0.1-v1.0.4); sprint-26 the stocktaking/inventory audit; sprint-27 collision fixes
  FB-1..5 (v1.0.5); sprint-28 player prediction tools (dossier + harness + SAS);
  sprint-29 submission predictor (producer sprint 2); sprint-30 player research polish
  (collapsible UX, league themes, LLM caching); sprint-34 phase-first round-phase
  operator model (v1.2.0); sprint-35 digest round-aware cross-round context, the ghost
  fix (v1.3.0). All closed and shipped. New themed work opens its own campaign rather
  than landing here.
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
signedOff: true
status: planned
followsFrom: the-b-side
sprints: []
note: >-
  NOT STARTED — sprints[] is intentionally empty. No b-side-polish sprint has executed
  yet: the sprint-34..39 slots were taken by higher-priority work (round-phase, the
  digest ghost fix, season-awareness, AI model management, cost management). The
  sprintPlan below is a PROPOSED grouping of the 20 `campaign: the-b-side-polish`
  roadmap cards — NOT executed sprints. Its `bsp-*` labels are placeholders; real sprint
  numbers (>= 42) get assigned at kickoff and added to sprints[] then.
summary: >-
  Follow-on to the shipped `the-b-side` campaign — turns the owner UAT
  (wiki/.../sessions/testing/2026-06-15-the-b-side-campaign-review.md) plus orc
  proposals into depth and polish. 20 roadmap cards tagged `campaign:
  the-b-side-polish` (12 `source: owner-uat`, 8 `source: orc-proposal`). The b-side
  shipped and is owner-ratified; nothing here is a release blocker. The proposed
  sprint shape below is a STARTING POINT for prioritization, not locked — sprint
  membership gets ratified before kickoff.
sprintPlan:
  - sprint: bsp-season-data-truth
    title: Season & data truth (foundation)
    goal: >-
      Make the b-side's knowledge of seasons/rounds correct and explicit, and
      robust to sparse data — the load-bearing slice everything content depends on.
      Sequence with the existing `active-league-management` roadmap card.
    cards:
      - bside-season-round-truth
      - bside-season-lens
      - bside-read-model-provenance
      - bside-degenerate-state-handling
      - bside-age-field-save-bug
      - bside-force-check-new-digests
  - sprint: bsp-superlatives-voice
    title: Superlatives & voice
    goal: >-
      The content engine — fewer/better/curated superlatives with tone control,
      meaningful color, and a tunable snark dial.
    cards:
      - bside-superlatives-curation
      - bside-superlative-visual-identity
      - bside-semantic-accent-system
      - bside-voice-snark-tuning
  - sprint: bsp-visual-mobile
    title: Visual & mobile polish
    goal: >-
      Fix the recurring mobile card-row UX, enrich the member grid, and strengthen
      the share/reshare moment.
    cards:
      - bside-mobile-card-rows
      - bside-member-grid-richness
      - bside-share-card-og-meta
      - bside-returning-visitor-diff
  - sprint: bsp-metrics-operator-qa
    title: Metrics correctness & operator QA
    goal: >-
      Normalize the tenure-skewed metrics, move fingerprints to real audio, and
      give the operator a safer update loop.
    cards:
      - bside-fan-hater-overlap-normalization
      - bside-real-audio-fingerprint
      - bside-update-diff-preview
      - bside-content-lint
  - sprint: bsp-avatars
    title: Themed LLM avatars
    goal: >-
      One-off and per-week theme-aligned LLM avatar batches. Stands alone (large);
      needs the per-player base image/description groundwork.
    cards:
      - bside-llm-avatars
  - sprint: bsp-moments-playlist
    title: Content depth — context channel, moments & the real playlist
    goal: >-
      The content-depth slice. Stand up the digest→read-model context channel
      (the non-published per-round "archive context" payload), then use it for
      chat-mined moments with an editor pass; turn the discovery playlist into a
      real, playable, linkable playlist. NOTE: now content-heavy with two large
      cards — likely splits when planned (the context channel may earn its own
      sprint; temporal generation is an idea-stage follow-on that depends on it).
    cards:
      - bside-digest-context-channel
      - bside-moments-chat-mined
      - bside-temporal-aware-generation
      - bside-discovery-playlist-link
      - bside-playlist-audio-integration
---
id: bside-season-awareness
title: the b-side — Season Awareness
kind: regular
signedOff: true
status: complete
completed: 2026-06-16
followsFrom: the-b-side
sprints:
  - sprint-36
  - sprint-37
summary: >-
  Made the b-side season-aware; shipped in v1.4.0. sprint-36 built the season/round
  data backbone (S1); sprint-37 shipped the narrated Season Update section ("The
  Pulse") on the public home (S2). Both coord-docs carry `campaign: bside-season-awareness`
  but the campaign was missing from the war table until the 2026-06-17 reconciliation.
---
id: ai-model-management
title: AI Model Management
kind: regular
signedOff: true
status: complete
completed: 2026-06-17
followOn: openrouter-cost-management
roadmapItem: openrouter-model-management
sprints:
  - sprint-38-ai-model-management
summary: >-
  Shipped v1.5.1. The Models & AI settings tab — OpenRouter key (masked,
  server-side), a saved-model roster (paste id, look up against the OpenRouter
  catalog, edit caps/cost/FREE), and two DB-backed model variables (Predict,
  Digest) with a DB-first resolver (db setting then env then hardcoded) wired at
  the generation sites. Settings became tabbed (App Settings, Music League Setup,
  Models and AI); Setup moved under Settings with the deadline tools. Realized the
  openrouter-model-management roadmap card. Follow-on cost work lives in the
  openrouter-cost-management campaign.
---
id: openrouter-cost-management
title: OpenRouter and LLM Cost Management
kind: regular
signedOff: false
followsFrom: ai-model-management
spike: model-cost-infra
sprints:
  - sprint-39-cost-ledger
  - sprint-42-usability-capture
  - sprint-40-cost-dashboard
  - sprint-41-per-section-models
summary: >-
  Continuation of ai-model-management. Make LLM spend visible, managed, and
  optimizable so we can test cheaply and flip to a high-end model only for weekly
  maintenance runs. From the model-cost-infra spike (a single Sonnet digest regen
  cost about 0.19 USD). Three sprints, sequenced: a per-call cost ledger (the data
  layer), then a debug-mode cost dashboard that visualizes it, then per-section
  model selection so cheap models run boilerplate and high-end models run only
  where it matters. Sprint membership and the proposed shape below are a starting
  point, ratified before each kickoff.
sprintPlan:
  - sprint: sprint-39-cost-ledger
    title: Cost tracking ledger plus cost-tier display fix
    goal: >-
      The data foundation. Record every OpenRouter call to a ledger (model,
      prompt and completion tokens, cost from the response usage, purpose of
      digest vs archive vs prediction and which section, league and round,
      timestamp) by hooking the shared callOpenRouter path and the prediction
      runner, and surfacing token counts that callOpenRouter currently drops.
      Bundle the small cost-tier display bug fix (all models show one dollar sign
      because per-token prices are compared against per-million thresholds).
    cards:
      - openrouter-cost-tracking
      - models-cost-tier-display-bug
  - sprint: sprint-42-usability-capture
    title: Usability and delight event capture
    goal: >-
      Executes after sprint-39 (which lays the schema plus the passive,
      can't-backfill fields) and before sprint-40 surfaces it. Wire the
      human-action outcome finalizers into controls that already exist, plus one
      new control, so the third KPI (usability) and its positive counterweight
      (delight) accrue from real use with no rating UI and no AI judge. Digest
      inline-edit marks an output salvaged with an edit-distance magnitude;
      regenerate or skip marks the prior output rejected; finalizing untouched
      marks it passed; a new thumbs-up control on a standout line writes a
      delight row; availability and capability failures write quarantined health
      events kept out of the usability score. Digest reaches the full ladder;
      prediction and b-side reach passed, rejected, or unusable only (no salvage
      rung). The schema and passive capture already shipped in sprint-39; this is
      the UI-side instrumentation half.
    cards:
      - llm-usability-delight-capture
  - sprint: sprint-40-cost-dashboard
    title: Debug mode plus cost dashboard
    goal: >-
      Depends on the sprint-39 ledger. A debug-mode toggle on Settings that
      reveals debug-only UI, whose first widget is the cost dashboard, today's
      total spend split by digest vs archive, a drilldown of individual calls,
      and a two-week chart of one stacked bar per day made of digest and archive
      calls in two base colors, each call a different shade with a hover tooltip
      naming the section. Includes a design pass for the chart.
    cards:
      - settings-debug-mode-cost-dashboard
  - sprint: sprint-41-per-section-models
    title: Per-section model selection
    goal: >-
      Independent, builds on the shipped sprint-38 resolver. Let each content
      section (digest sections, b-side read-model sections) optionally pin its
      own model, falling back to the global Predict or Digest default, so cheap
      models run boilerplate and high-end models run only where they matter. Also
      migrate the prediction tasks that still read a static env model at module
      load over to the DB-first resolver.
    cards:
      - per-section-model-selection
---
id: generation-pipeline
title: Generation Pipeline
kind: regular
signedOff: false
followsFrom: openrouter-cost-management
sprints:
  - sprint-43-pipeline-core
  - sprint-44-covers-ab-review
summary: >-
  Closes the production gap found after sprint-41: per-section model pins did
  nothing on a fresh digest because the draft was a single hard-coded call. A
  Release (digest/archive) now runs as a configurable pipeline — ordered tracks
  (sections) split into EPs at skips, same-model tracks merged into one call,
  later EPs reading earlier output as context — so pins bind on the initial draft
  with coherence kept where it matters (the one-skip default puts factual sections
  first, voice sections after). Covers re-run a section later on a better model;
  the A/B review pick is logged as a clean head-to-head model-preference signal
  for the cost campaign's quality work. From the CD pipeline handoff
  (docs/design/per-section-gen/). v1 shipped v1.10.0 + v1.11.0. v2 deferred:
  recoup budgeting, per-league profiles, feature/duets (see roadmap).
sprintPlan:
  - sprint: sprint-43-pipeline-core
    title: Pipeline core
    goal: >-
      Backend. Pipeline config + resolvePipeline (EP split at skips, group-by-model
      merge, prior-EP context) + rewire generateDraft + generalize the merge prompt +
      the one-skip default. Regression-guarded: a no-skip single-model pipeline reduces
      to exactly the prior single call. Closes the per-section-pins-on-initial-draft gap.
    cards:
      - generation-pipeline-core
  - sprint: sprint-44-covers-ab-review
    title: Covers plus A/B review
    goal: >-
      Auto-fire covers (re-run a section later on a better model with prior context),
      persist both takes, a cover A/B review surface in the digest flow, and log each
      pick to a new llm_preference table as a head-to-head quality signal. Default
      pipeline covers Flow on Sonnet.
    cards:
      - pipeline-covers-ab-review
  - sprint: sprint-45-pipeline-config-ui
    title: Pipeline config UI
    goal: >-
      Pull forward from v2 (owner needs to use the pipeline without coding). A UI to
      view and edit the shared pipeline — section order, per-section model, skip
      placement, and covers — instead of editing DEFAULT_PIPELINE/the settings row by
      hand. Writes the same pipeline_config the resolver already reads. Per-league
      profiles remain a later extension.
    cards:
      - pipeline-config-ui
