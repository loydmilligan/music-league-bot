export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS leagues (
    id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    exclude_from_combined INTEGER NOT NULL DEFAULT 0, notes TEXT
  );
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY, league_id INTEGER NOT NULL REFERENCES leagues(id),
    season_number INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','complete')),
    UNIQUE(league_id, season_number)
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY, season_id INTEGER NOT NULL REFERENCES seasons(id),
    ml_round_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT,
    spotify_playlist_url TEXT, submission_deadline TEXT, voting_deadline TEXT,
    theme_chooser_id INTEGER REFERENCES competitors(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS competitors (
    id INTEGER PRIMARY KEY, ml_competitor_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ml_submissions (
    id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL REFERENCES rounds(id),
    competitor_id INTEGER REFERENCES competitors(id),
    spotify_uri TEXT NOT NULL, title TEXT NOT NULL, album TEXT, artists TEXT NOT NULL,
    comment TEXT, created_at TEXT NOT NULL, visible_to_voters INTEGER NOT NULL DEFAULT 0,
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
`;

export const DEFAULT_SETTINGS: Record<string, string> = {
	weight_discovery: '35',
	weight_theme_fit: '25',
	weight_personal: '25',
	weight_nostalgia: '15'
};
