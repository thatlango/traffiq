CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS traffiq_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  category text,
  locality text,
  district text,
  city text,
  country text NOT NULL DEFAULT 'Uganda',
  country_code text NOT NULL DEFAULT 'ug',
  source text NOT NULL DEFAULT 'traffiq',
  source_ref text,
  confidence double precision NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  verified boolean NOT NULL DEFAULT false,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
  search_count bigint NOT NULL DEFAULT 0,
  selection_count bigint NOT NULL DEFAULT 0,
  journey_count bigint NOT NULL DEFAULT 0,
  last_selected_at timestamptz,
  last_verified_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_traffiq_places_name_trgm ON traffiq_places USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_traffiq_places_geo ON traffiq_places(lat, lng);
CREATE INDEX IF NOT EXISTS idx_traffiq_places_category ON traffiq_places(category);
CREATE INDEX IF NOT EXISTS idx_traffiq_places_popularity ON traffiq_places(selection_count DESC, journey_count DESC);

CREATE TABLE IF NOT EXISTS traffiq_place_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid NOT NULL REFERENCES traffiq_places(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL DEFAULT 'traffiq',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (place_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS idx_traffiq_place_alias_trgm ON traffiq_place_aliases USING gin (normalized_alias gin_trgm_ops);

CREATE TABLE IF NOT EXISTS traffiq_place_provider_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id uuid REFERENCES traffiq_places(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_place_id text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_place_id)
);
CREATE INDEX IF NOT EXISTS idx_place_provider_refs_place ON traffiq_place_provider_refs(place_id);

-- Private per-user memory. Saved places and journey endpoints are never
-- promoted into the shared place index simply because a user visited them.
CREATE TABLE IF NOT EXISTS user_place_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  normalized_label text NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  category text,
  formatted_address text,
  provider text,
  provider_place_id text,
  source text NOT NULL DEFAULT 'destination',
  use_count bigint NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, normalized_label, lat, lng)
);
CREATE INDEX IF NOT EXISTS idx_user_place_memory_user_recent ON user_place_memory(user_id, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_place_memory_label_trgm ON user_place_memory USING gin (normalized_label gin_trgm_ops);

CREATE TABLE IF NOT EXISTS place_search_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('search','selection','zero_result','correction')),
  query text,
  normalized_query text,
  lat_bucket numeric(5,2),
  lng_bucket numeric(6,2),
  provider text,
  result_count integer,
  selected_place_id uuid REFERENCES traffiq_places(id) ON DELETE SET NULL,
  selected_provider text,
  selected_provider_place_id text,
  latency_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_place_search_events_user ON place_search_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_search_events_query ON place_search_events(normalized_query, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_place_search_events_created ON place_search_events(created_at DESC);

-- Seed private place memory from explicit saved places only. This remains
-- user-scoped and therefore cannot leak Home/Work/custom locations globally.
INSERT INTO user_place_memory (
  user_id, label, normalized_label, lat, lng, category, formatted_address,
  provider_place_id, source, use_count, last_used_at
)
SELECT
  s.user_id,
  s.label,
  lower(regexp_replace(trim(s.label), '[^[:alnum:]]+', ' ', 'g')),
  s.lat,
  s.lng,
  s.kind,
  s.formatted_address,
  s.provider_place_id,
  'saved_place',
  GREATEST(COALESCE(s.visit_count, 0), 1),
  COALESCE(s.last_visited_at, s.updated_at, s.created_at)
FROM saved_places s
ON CONFLICT (user_id, normalized_label, lat, lng) DO UPDATE
SET
  use_count = GREATEST(user_place_memory.use_count, EXCLUDED.use_count),
  last_used_at = GREATEST(user_place_memory.last_used_at, EXCLUDED.last_used_at),
  updated_at = now();
