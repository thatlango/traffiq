ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 0;
ALTER TABLE saved_places ADD COLUMN IF NOT EXISTS last_visited_at timestamptz;

CREATE TABLE IF NOT EXISTS user_presence (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  page text,
  user_agent text,
  lat double precision CHECK (lat BETWEEN -90 AND 90),
  lng double precision CHECK (lng BETWEEN -180 AND 180),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_user_presence_recent ON user_presence(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_presence_geo ON user_presence(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;

CREATE TABLE IF NOT EXISTS place_name_cache (
  cache_key text PRIMARY KEY,
  name text NOT NULL,
  lat double precision,
  lng double precision,
  source text NOT NULL DEFAULT 'nominatim',
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);
CREATE INDEX IF NOT EXISTS idx_place_name_cache_expiry ON place_name_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_incidents_web_feed
  ON incidents(status, expires_at, updated_at DESC);
