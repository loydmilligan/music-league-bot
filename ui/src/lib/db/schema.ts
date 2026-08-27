export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    exclude_from_combined INTEGER NOT NULL DEFAULT 0, notes TEXT,
    -- sprint-22 active-round mgmt: is_active = manually-marked "currently being
    -- played" (D4 manual-first); active_round_id = the manual active-round slot
    -- (one per league, nullable). Resolution falls back to derived current-round
    -- when the slot is empty/dangling — see db/activeRound.ts.
    is_active INTEGER NOT NULL DEFAULT 0,
    active_round_id INTEGER REFERENCES rounds(id),
    -- digest auto-pipeline (task 4): per-league mode ('auto'|'hil'|'off',
    -- anything else defaults to 'off') and JSON-serialized default GenParams.
    digest_mode TEXT,
    digest_gen_params TEXT
  );
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL REFERENCES leagues(id),
    season_number INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','complete')),
    -- sprint-26 season-override-fix: manual flips via setSeasonStatus set 'manual';
    -- every import-path writer (upsertSeason) skips seasons with 'manual' in both
    -- directions. Default 'derived' so all existing rows behave as before.
    status_source TEXT NOT NULL CHECK(status_source IN ('derived','manual')) DEFAULT 'derived',
    -- SP1 source-aware seasons: which upstream service + that service's competition id
    -- this season maps to. Default 'music_league'; source_competition_id set at
    -- onboarding/backfill (the importer does not know the upstream id).
    source TEXT NOT NULL DEFAULT 'music_league',
    source_competition_id TEXT,
    UNIQUE(league_id, season_number)
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY, season_id INTEGER NOT NULL REFERENCES seasons(id),
    ml_round_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT,
    spotify_playlist_url TEXT, submission_deadline TEXT, voting_deadline TEXT,
    theme_chooser_id INTEGER REFERENCES competitors(id),
    created_at TEXT NOT NULL,
    phase TEXT CHECK(phase IN ('not-started', 'submission', 'voting', 'complete'))
  );
  CREATE TABLE IF NOT EXISTS competitors (
    id INTEGER PRIMARY KEY, ml_competitor_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ml_submissions (
    id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES rounds(id),
    competitor_id INTEGER REFERENCES competitors(id),
    spotify_uri TEXT NOT NULL, title TEXT NOT NULL, album TEXT, artists TEXT NOT NULL,
    comment TEXT, created_at TEXT NOT NULL, visible_to_voters INTEGER NOT NULL DEFAULT 0,
    album_art_url TEXT,
    UNIQUE(round_id, spotify_uri, competitor_id)
  );
  -- Anonymous playlist-ingest rows (competitor_id NULL) need a separate
  -- uniqueness guarantee since SQLite treats NULL as distinct in the
  -- composite UNIQUE above. Partial index → INSERT OR IGNORE works.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_submissions_anon
    ON ml_submissions(round_id, spotify_uri)
    WHERE competitor_id IS NULL;
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES rounds(id),
    voter_id INTEGER NOT NULL REFERENCES competitors(id),
    spotify_uri TEXT NOT NULL, points INTEGER NOT NULL, comment TEXT, created_at TEXT NOT NULL,
    UNIQUE(round_id, voter_id, spotify_uri)
  );
  CREATE TABLE IF NOT EXISTS research_songs (
    id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES rounds(id),
    spotify_uri TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT,
    added_at TEXT NOT NULL, notes TEXT,
    theme_fit INTEGER CHECK(theme_fit BETWEEN 1 AND 5),
    discovery_potential INTEGER CHECK(discovery_potential BETWEEN 1 AND 5),
    nostalgia_potential INTEGER CHECK(nostalgia_potential BETWEEN 1 AND 5),
    personal_rating INTEGER CHECK(personal_rating BETWEEN 1 AND 5),
    save_for_future INTEGER NOT NULL DEFAULT 0,
    submitted_by_me INTEGER NOT NULL DEFAULT 0,
    submitted_by_other INTEGER NOT NULL DEFAULT 0,
    other_submission_votes INTEGER,
    status TEXT NOT NULL DEFAULT 'reviewing',
    UNIQUE(round_id, spotify_uri)
  );
  CREATE TABLE IF NOT EXISTS head_to_head_matches (
    id INTEGER PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    winner_id INTEGER NOT NULL REFERENCES research_songs(id),
    loser_id INTEGER NOT NULL REFERENCES research_songs(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_h2h_round_created
    ON head_to_head_matches(round_id, created_at);
  -- Phase 1 MCP: the currently-proposed random-mode pairing for a round.
  -- One row per round (round_id is the PK) — king-of-the-hill mode needs no
  -- equivalent since it's fully re-derived from match history on every read;
  -- a random pairing is arbitrary and must be persisted to survive a reshuffle
  -- or a later "select winner" call.
  CREATE TABLE IF NOT EXISTS h2h_pending_matchup (
    round_id INTEGER PRIMARY KEY REFERENCES rounds(id),
    song_a_id INTEGER NOT NULL REFERENCES research_songs(id),
    song_b_id INTEGER NOT NULL REFERENCES research_songs(id),
    mode TEXT NOT NULL DEFAULT 'random',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ytm_link_cache (
    spotify_uri TEXT PRIMARY KEY, ytm_url TEXT, resolved_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ytm_resolution_queue (
    id INTEGER PRIMARY KEY, spotify_uri TEXT NOT NULL UNIQUE,
    title TEXT, artist TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
    error TEXT, queued_at TEXT NOT NULL, resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS import_log (
    id INTEGER PRIMARY KEY, league_slug TEXT NOT NULL, season_number INTEGER NOT NULL,
    filename TEXT NOT NULL, imported_at TEXT NOT NULL,
    rounds_count INTEGER NOT NULL DEFAULT 0, submissions_count INTEGER NOT NULL DEFAULT 0,
    votes_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('success','partial','error')), error TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS shortlist_songs (
    id              TEXT PRIMARY KEY,
    spotify_uri     TEXT NOT NULL UNIQUE,
    artist          TEXT NOT NULL,
    title           TEXT NOT NULL,
    album           TEXT,
    year            INTEGER,
    duration_sec    INTEGER,
    album_art_url   TEXT,
    added_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    rating_discovery INTEGER NOT NULL DEFAULT 0,
    rating_theme_fit INTEGER NOT NULL DEFAULT 0,
    rating_nostalgia INTEGER NOT NULL DEFAULT 0,
    rating_personal  INTEGER NOT NULL DEFAULT 0,
    submitted_elsewhere INTEGER NOT NULL DEFAULT 0,
    notes           TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS shortlist_assignments (
    shortlist_song_id TEXT NOT NULL REFERENCES shortlist_songs(id) ON DELETE CASCADE,
    round_id          INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    assigned_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (shortlist_song_id, round_id)
  );
  CREATE INDEX IF NOT EXISTS idx_shortlist_assignments_round
    ON shortlist_assignments(round_id);
  CREATE TABLE IF NOT EXISTS chat_songs (
    id              TEXT PRIMARY KEY,
    spotify_uri     TEXT NOT NULL UNIQUE,
    artist          TEXT NOT NULL,
    title           TEXT NOT NULL,
    album           TEXT,
    year            INTEGER,
    duration_sec    INTEGER,
    album_art_url   TEXT,
    dismissed       INTEGER NOT NULL DEFAULT 0,
    first_seen_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS chat_mentions (
    id              TEXT PRIMARY KEY,
    song_id         TEXT NOT NULL REFERENCES chat_songs(id) ON DELETE CASCADE,
    chat_name       TEXT NOT NULL,
    sender_name     TEXT NOT NULL,
    captured_at     TEXT NOT NULL,
    raw_message     TEXT NOT NULL,
    prior_messages  TEXT NOT NULL DEFAULT '[]',
    intent          TEXT NOT NULL DEFAULT 'unclassified'
  );
  CREATE TABLE IF NOT EXISTS chat_assignments (
    chat_song_id    TEXT NOT NULL REFERENCES chat_songs(id) ON DELETE CASCADE,
    round_id        INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    assigned_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (chat_song_id, round_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_mentions_song ON chat_mentions(song_id);
  CREATE INDEX IF NOT EXISTS idx_chat_assignments_round ON chat_assignments(round_id);
  CREATE TABLE IF NOT EXISTS digest_drafts (
    id                TEXT PRIMARY KEY,
    round_id          INTEGER NOT NULL REFERENCES rounds(id),
    generated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    finalized_at      TEXT,
    rel_context       TEXT NOT NULL,
    prep_checks       TEXT NOT NULL,
    whole_regen_count INTEGER NOT NULL DEFAULT 0,
    -- sprint-15 cost-capture: accumulated OpenRouter USD cost for this digest
    -- (draft generation + every regen / section gen).
    llm_cost_usd      REAL NOT NULL DEFAULT 0,
    -- sprint-21 season-recap: the draft was generated in recap mode (season
    -- scope) and whether it's a FINAL recap (champion/past tense) vs mid-season
    -- ("so far, through R{N}"). Read by regen + the data-section framing.
    recap_enabled     INTEGER NOT NULL DEFAULT 0,
    recap_final       INTEGER NOT NULL DEFAULT 1,
    top_section_variant TEXT NOT NULL DEFAULT 'auto',
    top_section_visuals TEXT NOT NULL DEFAULT '[]',
    stats_position INTEGER NOT NULL DEFAULT 0,
    stats_state TEXT NOT NULL DEFAULT 'default',
    stats_content_json TEXT NOT NULL DEFAULT '{}',
    guesser_position INTEGER NOT NULL DEFAULT 0,
    guesser_state TEXT NOT NULL DEFAULT 'default',
    guesser_content_json TEXT NOT NULL DEFAULT '{}',
    reel_position INTEGER NOT NULL DEFAULT 0,
    reel_state TEXT NOT NULL DEFAULT 'default',
    reel_content_json TEXT NOT NULL DEFAULT '{}',
    archive_context TEXT                        -- S1: lean digest->read-model channel (JSON), non-published
  );
  CREATE INDEX IF NOT EXISTS idx_digest_drafts_round ON digest_drafts(round_id);
  CREATE TABLE IF NOT EXISTS digest_sections (
    id           TEXT PRIMARY KEY,
    draft_id     TEXT NOT NULL REFERENCES digest_drafts(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK(kind IN ('podium','villain','flow','consensus','quotes','chat','storylines')),
    position     INTEGER NOT NULL,
    state        TEXT NOT NULL DEFAULT 'default' CHECK(state IN ('default','excluded','locked')),
    content_json TEXT NOT NULL,
    edited_at    TEXT,
    regen_count  INTEGER NOT NULL DEFAULT 0,
    -- sprint-14 variant-system: per-section layout variant the renderer slots
    -- (frontend variant mechanism; backend generation-wiring writes it from the
    -- generate modal's Generation-params per-section choice).
    variant      TEXT NOT NULL DEFAULT 'textual' CHECK(variant IN ('textual','visual','both'))
  );
  CREATE INDEX IF NOT EXISTS idx_digest_sections_draft ON digest_sections(draft_id, position);
  CREATE TABLE IF NOT EXISTS digest_regenerations (
    id                 TEXT PRIMARY KEY,
    section_id         TEXT NOT NULL REFERENCES digest_sections(id) ON DELETE CASCADE,
    ran_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    chips              TEXT NOT NULL,
    instructions       TEXT NOT NULL,
    prior_content_json TEXT NOT NULL,
    new_content_json   TEXT NOT NULL,
    cover_kind         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_digest_regenerations_section ON digest_regenerations(section_id, ran_at);
  -- sprint-20 html-share: stable, unguessable slug per round for the public
  -- digest.mattmariani.com/d/<slug> artifact. One row per round (PK = round_id)
  -- so a round always resolves to the SAME slug; re-export overwrites in place.
  -- Auto-post idempotency. One row per round, claimed BEFORE the send so a
  -- crash or a double-tick cannot post twice. sent_at NULL = claimed but not
  -- confirmed; a post-send failure keeps the claim (see digest/sendLog.ts).
  CREATE TABLE IF NOT EXISTS digest_sends (
    round_id   INTEGER PRIMARY KEY REFERENCES rounds(id),
    league_id  INTEGER NOT NULL REFERENCES leagues(id),
    claimed_at TEXT NOT NULL,
    sent_at    TEXT,
    target     TEXT,
    url        TEXT,
    error      TEXT
  );
  CREATE TABLE IF NOT EXISTS digest_jobs (
    round_id       INTEGER PRIMARY KEY REFERENCES rounds(id),
    league_id      INTEGER NOT NULL REFERENCES leagues(id),
    status         TEXT NOT NULL,
    gen_params     TEXT,
    error          TEXT,
    approval_token TEXT,
    decision       TEXT,
    decided_at     TEXT,
    review_url     TEXT,
    attempts       INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS digest_shares (
    round_id   INTEGER PRIMARY KEY REFERENCES rounds(id),
    slug       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  -- Canonical, human-verifiable season standings (sprint-14 D2). One row per
  -- (round, competitor): the competitor's running totals AS OF that round.
  -- prior_total = points received in earlier rounds; round_points = points this
  -- round; current_total = prior_total + round_points. rank/prev_rank are the
  -- standing positions by current_total / prior_total. This table is the gospel
  -- the digest renders from; gen-time reconciliation diffs computed-from-votes
  -- against it and the human can adopt-computed or hand-edit (always overwrites).
  CREATE TABLE IF NOT EXISTS season_standings (
    season_id     INTEGER NOT NULL REFERENCES seasons(id),
    round_id      INTEGER NOT NULL REFERENCES rounds(id),
    competitor_id INTEGER NOT NULL REFERENCES competitors(id),
    name          TEXT NOT NULL,
    prior_total   INTEGER NOT NULL DEFAULT 0,
    round_points  INTEGER NOT NULL DEFAULT 0,
    current_total INTEGER NOT NULL DEFAULT 0,
    rank          INTEGER NOT NULL,
    prev_rank     INTEGER,
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (round_id, competitor_id)
  );
  CREATE INDEX IF NOT EXISTS idx_season_standings_round ON season_standings(round_id, rank);
  -- Per-song popularity metadata (sprint-17). Fetched once from Last.fm + Spotify
  -- and persisted so the digest reads a STORED score (src/ is outside the ui build
  -- context — never call Last.fm at render). Keyed by spotify_uri (songs recur
  -- across rounds). popularity_proxy = log-normalized listeners+playcount → 0-100
  -- (computePopularityProxies over the whole corpus); obscurity = 100 − proxy.
  CREATE TABLE IF NOT EXISTS song_popularity (
    spotify_uri        TEXT PRIMARY KEY,
    artist             TEXT NOT NULL,
    title              TEXT NOT NULL,
    listeners          INTEGER,
    playcount          INTEGER,
    popularity_proxy   INTEGER,
    spotify_popularity INTEGER,
    fetched_at         TEXT NOT NULL,
    -- sprint-queue Task 2: Last.fm genre tags (JSON array of strings, top-5 by count)
    tags               TEXT,
    -- sprint-queue Task 2 (popularity_source): which data source set popularity_proxy
    -- (lastfm | spotify | manual). NULL until a fetch job completes.
    popularity_source  TEXT
  );
  -- Audio features from sintel (librosa analysis). Keyed by spotify_uri; shared
  -- across rounds. bpm and key are derived from the audio file, not Spotify metadata.
  CREATE TABLE IF NOT EXISTS song_audio_features (
    spotify_uri  TEXT PRIMARY KEY,
    bpm          REAL NOT NULL,
    key          TEXT NOT NULL,
    scale        TEXT NOT NULL CHECK(scale IN ('major','minor')),
    energy       REAL NOT NULL,
    duration_s   REAL NOT NULL,
    analyzed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE TABLE IF NOT EXISTS api_tokens (
    id            INTEGER PRIMARY KEY,
    hash          TEXT NOT NULL UNIQUE,
    label         TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    last_used_at  TEXT,
    revoked_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_api_tokens_active ON api_tokens(hash) WHERE revoked_at IS NULL;
  CREATE TABLE IF NOT EXISTS relationship_contexts (
    league_id            INTEGER PRIMARY KEY REFERENCES leagues(id),
    text                 TEXT NOT NULL DEFAULT '',
    updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    last_round_id        INTEGER REFERENCES rounds(id),
    previous_text        TEXT,
    previous_updated_at  TEXT
  );
  -- sprint-22 theme property-tags (D11). Themes carry property tags so Phase-3
  -- similarity = TAG OVERLAP, no LLM. Three tables: a seeded, extensible
  -- category taxonomy; a (category,value) tag vocabulary; and a round↔tag join.
  -- A round can carry many tags; a tag is reused across rounds → overlap = a
  -- join on round_theme_tags. Seeded by seedThemeTags() (db/themeTags.ts).
  CREATE TABLE IF NOT EXISTS theme_tag_categories (
    key         TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS theme_tags (
    id         INTEGER PRIMARY KEY,
    category   TEXT NOT NULL REFERENCES theme_tag_categories(key),
    value      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(category, value)
  );
  CREATE TABLE IF NOT EXISTS round_theme_tags (
    round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES theme_tags(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (round_id, tag_id)
  );
  -- reverse lookup (which rounds share a tag) — the similarity-engine path.
  CREATE INDEX IF NOT EXISTS idx_round_theme_tags_tag ON round_theme_tags(tag_id);
  -- sprint-38 ai-model-management: user-curated model roster + two bucket settings.
  -- model_id is the OpenRouter id string (provider/model-name). Caps are stored as
  -- 0/1 integers so SQLite handles them; is_free and cost_override let the UI
  -- compute a cost tier badge without hitting the API on every render.
  CREATE TABLE IF NOT EXISTS ai_models (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id    TEXT NOT NULL UNIQUE,
    nickname    TEXT,
    description TEXT,
    model_type  TEXT,
    context_len INTEGER,
    price_in    REAL,
    price_out   REAL,
    is_free     INTEGER NOT NULL DEFAULT 0,
    cost_override REAL,
    cap_reason  INTEGER NOT NULL DEFAULT 0,
    cap_stream  INTEGER NOT NULL DEFAULT 0,
    cap_vision  INTEGER NOT NULL DEFAULT 0,
    cap_tools   INTEGER NOT NULL DEFAULT 0,
    cap_json    INTEGER NOT NULL DEFAULT 0,
    favorite    INTEGER NOT NULL DEFAULT 0,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  -- sprint-39 cost ledger: per-call LLM cost log for the DIGEST path only.
  -- predict/archive calls federate via prediction_runs (contract #6).
  -- Append-only; no deletes. Passive usability fields set at generation time;
  -- human-action outcome fields (edit_distance, regen_changed) populated by
  -- the follow-on usability-capture sprint.
  CREATE TABLE IF NOT EXISTS llm_cost_log (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    model                TEXT    NOT NULL,
    prompt_tokens        INTEGER NOT NULL DEFAULT 0,
    completion_tokens    INTEGER NOT NULL DEFAULT 0,
    total_tokens         INTEGER NOT NULL DEFAULT 0,
    cost_usd             REAL    NOT NULL DEFAULT 0,
    latency_ms           INTEGER NOT NULL DEFAULT 0,
    category             TEXT    NOT NULL,
    label                TEXT    NOT NULL,
    -- join keys (can't-backfill: tie a call to the exact generation it produced)
    run_id               TEXT,
    artifact_type        TEXT,
    artifact_id          TEXT,
    prompt_version       TEXT,
    output_hash          TEXT,
    -- usability: passive fields set now; human-action outcomes finalized later
    outcome              TEXT,
    recovery_cost        REAL,
    retry_count          INTEGER NOT NULL DEFAULT 0,
    edit_distance        REAL,
    regen_changed        TEXT,
    -- params capture
    params               TEXT,
    params_schema_version INTEGER,
    league_id            INTEGER,
    round_id             INTEGER
  );
  -- sprint-39 side tables: created now, populated by the follow-on usability sprint.
  -- llm_health_event: quarantined availability/config axis (NOT quality).
  CREATE TABLE IF NOT EXISTS llm_health_event (
    id           TEXT PRIMARY KEY,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    cost_log_id  TEXT,
    error_class  TEXT,
    model        TEXT,
    detail       TEXT
  );
  -- llm_delight: sparse human thumbs-up on a standout line.
  CREATE TABLE IF NOT EXISTS llm_delight (
    id           TEXT PRIMARY KEY,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    cost_log_id  TEXT,
    span         TEXT,
    subsection   TEXT,
    note         TEXT
  );
  -- sprint-44 cover A/B preference signal: head-to-head model quality data.
  -- One row per pick; most-recent row per (regen_id) is canonical.
  -- Append-only — never delete or upsert. Used by the cost campaign quality work.
  CREATE TABLE IF NOT EXISTS llm_preference (
    id                    TEXT PRIMARY KEY,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    section               TEXT NOT NULL,
    round_id              INTEGER REFERENCES rounds(id),
    original_model        TEXT NOT NULL,
    cover_model           TEXT NOT NULL,
    original_cost_log_id  INTEGER,
    cover_cost_log_id     INTEGER,
    regen_id              TEXT REFERENCES digest_regenerations(id),
    picked                TEXT NOT NULL CHECK(picked IN ('original','cover')),
    picked_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_llm_preference_round ON llm_preference(round_id, section);
  -- Unified song metadata queue (sprint-queue). One row per (spotify_uri, job_type)
  -- pair. job_type ∈ {ytm, lastfm_pop, lastfm_tags, audio, lyrics}. Idempotent
  -- INSERT OR IGNORE; workers claim rows by setting status='processing'.
  -- ytm_resolution_queue retained in schema for migration safety; ytmQueue.ts and worker references removed.
  CREATE TABLE IF NOT EXISTS song_metadata_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    spotify_uri TEXT NOT NULL,
    job_type   TEXT NOT NULL CHECK(job_type IN ('ytm','lastfm_pop','lastfm_tags','audio','lyrics')),
    status     TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
    error      TEXT,
    retries    INTEGER NOT NULL DEFAULT 0,
    queued_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    started_at TEXT,
    done_at    TEXT,
    UNIQUE(spotify_uri, job_type)
  );
  CREATE INDEX IF NOT EXISTS idx_song_metadata_queue_status ON song_metadata_queue(status, job_type);
  CREATE INDEX IF NOT EXISTS idx_ml_submissions_uri_round ON ml_submissions(spotify_uri, round_id);
  CREATE INDEX IF NOT EXISTS idx_song_metadata_queue_uri ON song_metadata_queue(spotify_uri);
  -- Lyrics presence cache (sprint-queue Task 2 LRCLIB handler).
  -- has_lyrics = 1 when LRCLIB returned a result, 0 when not found.
  CREATE TABLE IF NOT EXISTS song_lyrics_metrics (
    spotify_uri TEXT PRIMARY KEY,
    has_lyrics  INTEGER NOT NULL DEFAULT 0,
    word_count  INTEGER,
    line_count  INTEGER,
    fetched_at  TEXT NOT NULL
  );
  -- Theme Strategy Brief cache (sprint-queue). One row per round: the
  -- assembled ThemeBrief JSON, so the UI reads a cached result instead of
  -- re-running the matcher/LLM synth on every view.
  CREATE TABLE IF NOT EXISTS theme_briefs (
    round_id     INTEGER PRIMARY KEY,
    brief_json   TEXT NOT NULL,
    model        TEXT,
    cost_usd     REAL,
    generated_at TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  -- Voting Phase Lab (2026-07-23): the owner's private per-round scratchpad.
  -- One row per (round, song). Never submitted anywhere — copy-out only.
  CREATE TABLE IF NOT EXISTS voting_lab_ballot (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    spotify_uri TEXT NOT NULL,
    up_points INTEGER NOT NULL DEFAULT 0,
    down_points INTEGER NOT NULL DEFAULT 0,
    rating INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    draft_comment TEXT NOT NULL DEFAULT '',
    is_mine INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (round_id, spotify_uri)
  );
  -- Per-round budget override. Absent row => inherit the season default.
  CREATE TABLE IF NOT EXISTS voting_lab_budget (
    round_id INTEGER PRIMARY KEY REFERENCES rounds(id),
    up_total INTEGER NOT NULL,
    down_total INTEGER NOT NULL,
    per_song_cap INTEGER,
    updated_at TEXT NOT NULL
  );
  -- Season-level default budget, edited in Settings. Rosters grow within a
  -- season, so season is the right grain; rounds may still override.
  CREATE TABLE IF NOT EXISTS season_vote_budget (
    season_id INTEGER PRIMARY KEY REFERENCES seasons(id),
    up_total INTEGER NOT NULL,
    down_total INTEGER NOT NULL,
    per_song_cap INTEGER,
    updated_at TEXT NOT NULL
  );

  -- ── Tables created outside schema.ts, mirrored here so in-memory test DBs
  -- have them. DDL copied verbatim from data/league.db on 2026-08-26; these are
  -- CREATE TABLE IF NOT EXISTS, so the live tables are never altered.
  -- digest_bridges + digest_ledes are created by scripts/digest-qa/*.py;
  -- player_participation by scripts/digest-qa/participation.py.
  CREATE TABLE IF NOT EXISTS digest_bridges (
    round_id     INTEGER PRIMARY KEY REFERENCES rounds(id),
    league_id    INTEGER NOT NULL,
    draft_id     TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    content_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS digest_ledes (
    round_id     INTEGER PRIMARY KEY REFERENCES rounds(id),
    generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    content_json TEXT NOT NULL,
    ratings_json TEXT
  );

  CREATE TABLE IF NOT EXISTS player_participation (
    league_id     INTEGER NOT NULL,
    round_id      INTEGER NOT NULL,
    competitor_id INTEGER NOT NULL,
    voted REAL NOT NULL DEFAULT 0,
    submitted REAL NOT NULL DEFAULT 0,
    vote_comments REAL NOT NULL DEFAULT 0,
    vote_comment_chars REAL NOT NULL DEFAULT 0,
    sub_comment_chars REAL NOT NULL DEFAULT 0,
    msgs REAL NOT NULL DEFAULT 0,
    chars REAL NOT NULL DEFAULT 0,
    days_active REAL NOT NULL DEFAULT 0,
    music_links REAL NOT NULL DEFAULT 0,
    media REAL NOT NULL DEFAULT 0,
    other_links REAL NOT NULL DEFAULT 0,
    bursts_joined REAL NOT NULL DEFAULT 0,
    group_discussions_joined REAL NOT NULL DEFAULT 0,
    elicited REAL NOT NULL DEFAULT 0,
    mentions_made REAL NOT NULL DEFAULT 0,
    mentions_received REAL NOT NULL DEFAULT 0,
    temporal_overlap REAL NOT NULL DEFAULT 0,
    rounds_in_league REAL NOT NULL DEFAULT 0,
    median_hour REAL NOT NULL DEFAULT 0,
    share_off_peak REAL NOT NULL DEFAULT 0,
    computed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (league_id, round_id, competitor_id)
  );

  -- ── Round prep panel (spec 2026-08-26-round-prep-panel-design).
  -- target is validated in code (roundNotes.ts), not by a CHECK constraint, so
  -- adding a section kind later does not need a table rebuild.
  CREATE TABLE IF NOT EXISTS round_notes (
    id         TEXT PRIMARY KEY,
    round_id   INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    target     TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS round_notes_round ON round_notes(round_id);

  -- Separate from digest_ledes on purpose: no collision with generate_ledes.py's
  -- "already has a row, use --force" guard, and the real run can never clobber
  -- mid-round ratings.
  CREATE TABLE IF NOT EXISTS digest_early_ledes (
    round_id     INTEGER PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
    content_json TEXT NOT NULL,
    ratings_json TEXT,
    generated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rollout_configs (
    league_id       INTEGER PRIMARY KEY REFERENCES leagues(id),
    definition_json TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rollout_runs (
    id              TEXT PRIMARY KEY,
    league_id       INTEGER NOT NULL REFERENCES leagues(id),
    round_id        INTEGER NOT NULL REFERENCES rounds(id),
    definition_json TEXT NOT NULL,
    state           TEXT NOT NULL CHECK(state IN ('running','parked','done','failed')),
    current_ep      INTEGER NOT NULL DEFAULT 0,
    resume_token    TEXT,
    review_url      TEXT,
    error           TEXT,
    started_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    finished_at     TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS rollout_runs_round ON rollout_runs(round_id);

  CREATE TABLE IF NOT EXISTS rollout_cut_runs (
    run_id       TEXT NOT NULL REFERENCES rollout_runs(id) ON DELETE CASCADE,
    cut_id       TEXT NOT NULL,
    ep           INTEGER NOT NULL,
    runtime      TEXT,
    state        TEXT NOT NULL CHECK(state IN ('pending','running','done','failed','skipped')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    remasters    INTEGER NOT NULL DEFAULT 0,
    check_passed INTEGER,
    -- Set by the host executor when it writes a raw done/failed result: this
    -- row has NOT yet passed through the engine's check/retry/remaster logic.
    -- The app executor clears it the moment it reclassifies via applyCutResult.
    awaiting_classification INTEGER NOT NULL DEFAULT 0,
    claimed_at   TEXT,
    heartbeat_at TEXT,
    output_json  TEXT,
    error        TEXT,
    started_at   TEXT,
    finished_at  TEXT,
    PRIMARY KEY (run_id, cut_id)
  );

`;

export const DEFAULT_SETTINGS: Record<string, string> = {
	weight_discovery: '35',
	weight_theme_fit: '25',
	weight_personal: '25',
	weight_nostalgia: '15',
	weight_quality: '20',
	weight_replayability: '10',
	taste_settings: JSON.stringify({
		signal: 'frac', votePct: 5, negatives: true, dnPct: 100, lyrWeight: 0.45, spread: 1.15, scopeAll: true,
		showLabels: true, showKey: true, showRead: true, showChips: true, showLeagueAvg: false,
	}),
};
