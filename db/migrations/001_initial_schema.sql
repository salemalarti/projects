-- 001_initial_schema.sql
-- Core schema for the Roblox Analytics MVP (Phase 1b + Phase 2).
-- Safe to run on a fresh Supabase project. Run via `npm run db:migrate`
-- or paste into the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- games: one row per Roblox experience (universe). Identity + descriptive data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
  id              BIGSERIAL PRIMARY KEY,
  universe_id     BIGINT      NOT NULL UNIQUE CHECK (universe_id > 0),
  root_place_id   BIGINT      CHECK (root_place_id > 0),
  name            TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  description     TEXT,
  genre           TEXT,        -- legacy Roblox genre field (often "All")
  genre_l1        TEXT,        -- current Roblox genre (e.g. "Roleplay & Avatar Sim")
  genre_l2        TEXT,        -- current Roblox subgenre
  creator_name    TEXT,
  creator_type    TEXT,
  max_players     INTEGER,
  release_date    TIMESTAMPTZ, -- Roblox "created" timestamp of the universe
  roblox_updated_at TIMESTAMPTZ, -- Roblox "updated" timestamp (last publish)
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_genre_l1_idx ON games (genre_l1);
CREATE INDEX IF NOT EXISTS games_last_seen_idx ON games (last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- game_snapshots: one row per game per UTC day. Raw, directly-sourced numbers.
-- Re-running the scraper on the same day updates that day's row (idempotent).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_snapshots (
  id                 BIGSERIAL PRIMARY KEY,
  game_id            BIGINT      NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  snapshot_date      DATE        NOT NULL,
  captured_at        TIMESTAMPTZ NOT NULL,
  visits             BIGINT      NOT NULL CHECK (visits >= 0),
  concurrent_players INTEGER     NOT NULL CHECK (concurrent_players >= 0),
  favorites          BIGINT      CHECK (favorites >= 0),
  up_votes           BIGINT      CHECK (up_votes >= 0),
  down_votes         BIGINT      CHECK (down_votes >= 0),
  source_sorts       TEXT[]      NOT NULL DEFAULT '{}', -- which Roblox charts listed it that day
  UNIQUE (game_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS game_snapshots_game_time_idx ON game_snapshots (game_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS game_snapshots_date_idx ON game_snapshots (snapshot_date);

-- ---------------------------------------------------------------------------
-- game_stats: derived numbers recalculated after every scrape (cache for the API).
-- Everything here is CALCULATED from game_snapshots, never invented.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_stats (
  game_id                 BIGINT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  latest_visits           BIGINT,
  latest_concurrent       INTEGER,
  latest_favorites        BIGINT,
  latest_up_votes         BIGINT,
  latest_down_votes       BIGINT,
  latest_captured_at      TIMESTAMPTZ,
  first_captured_at       TIMESTAMPTZ,
  snapshot_count          INTEGER NOT NULL DEFAULT 0,
  visits_per_day_7d       DOUBLE PRECISION, -- average visits gained per day, last 7 days
  visits_growth_7d_pct    DOUBLE PRECISION, -- last 7d visit velocity vs previous 7d
  visits_growth_30d_pct   DOUBLE PRECISION, -- last 30d visit velocity vs previous 30d
  concurrent_change_7d_pct DOUBLE PRECISION, -- latest CCU vs ~7 days earlier
  trend                   TEXT NOT NULL DEFAULT 'insufficient_data'
                          CHECK (trend IN ('up', 'stable', 'down', 'insufficient_data')),
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_stats_concurrent_idx ON game_stats (latest_concurrent DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS game_stats_growth_idx ON game_stats (visits_growth_7d_pct DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- game_metrics: metrics Roblox does NOT expose publicly (retention, session
-- length, monetization). Table exists so they can be added later from a
-- legitimate source (e.g. developer-shared data). Left EMPTY on purpose.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_metrics (
  game_id               BIGINT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  retention_d1_rate     DOUBLE PRECISION CHECK (retention_d1_rate BETWEEN 0 AND 1),
  avg_session_minutes   DOUBLE PRECISION CHECK (avg_session_minutes >= 0),
  monetization_methods  TEXT[],
  source                TEXT NOT NULL,       -- where the number came from (required)
  is_estimate           BOOLEAN NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- scrape_runs: log of every data collection run (powers "Data updated at").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_runs (
  id             BIGSERIAL PRIMARY KEY,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'success', 'partial', 'failed')),
  games_found    INTEGER NOT NULL DEFAULT 0,
  games_stored   INTEGER NOT NULL DEFAULT 0,
  games_skipped  INTEGER NOT NULL DEFAULT 0,
  error_summary  TEXT
);
CREATE INDEX IF NOT EXISTS scrape_runs_finished_idx ON scrape_runs (finished_at DESC);

-- ---------------------------------------------------------------------------
-- beta_signups: landing-page signups. Tokens are stored ONLY as SHA-256 hashes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS beta_signups (
  id                       BIGSERIAL PRIMARY KEY,
  name                     TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email                    TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  roblox_username          TEXT,
  game_experience          TEXT,
  interest                 TEXT,
  source                   TEXT NOT NULL DEFAULT 'landing',
  status                   TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed', 'disabled')),
  email_confirmed          BOOLEAN NOT NULL DEFAULT false,
  email_confirmed_at       TIMESTAMPTZ,
  confirmation_token_hash  TEXT UNIQUE,
  confirmation_expires_at  TIMESTAMPTZ,
  access_token_hash        TEXT UNIQUE,
  last_email_sent_at       TIMESTAMPTZ,
  last_access_at           TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS beta_signups_email_unique ON beta_signups (lower(email));

-- ---------------------------------------------------------------------------
-- events: lightweight, anonymous product analytics (page views, signups, usage).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT,
  session_id  TEXT,
  props       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_name_time_idx ON events (name, created_at DESC);

-- ---------------------------------------------------------------------------
-- Lock down Supabase's auto-generated public REST API. The app connects
-- server-side with the database connection string, so it is unaffected;
-- anyone holding the public "anon" key gets NO access to these tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['games','game_snapshots','game_stats','game_metrics',
                           'scrape_runs','beta_signups','events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
