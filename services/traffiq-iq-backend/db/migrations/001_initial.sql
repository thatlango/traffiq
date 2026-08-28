CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  phone text UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('android','ios','web')),
  push_token text,
  app_version text,
  os_version text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('car','motorcycle','taxi','bus','truck','bicycle','walking','other')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','paused','completed','cancelled')),
  origin_name text,
  origin_lat double precision,
  origin_lng double precision,
  destination_name text,
  destination_lat double precision,
  destination_lng double precision,
  route_provider text,
  route_polyline text,
  planned_distance_m integer,
  planned_duration_s integer,
  started_at timestamptz,
  ended_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_location_at timestamptz,
  distance_m double precision NOT NULL DEFAULT 0,
  duration_s integer NOT NULL DEFAULT 0,
  max_speed_mps double precision NOT NULL DEFAULT 0,
  avg_speed_mps double precision NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);

CREATE TABLE IF NOT EXISTS journey_points (
  id bigserial PRIMARY KEY,
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  client_point_id uuid NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m double precision,
  speed_mps double precision,
  bearing_deg double precision,
  altitude_m double precision,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'gps',
  UNIQUE(journey_id, client_point_id)
);

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id uuid REFERENCES journeys(id) ON DELETE SET NULL,
  client_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('accident','hazard','roadblock','police','traffic','road_damage','flooding','construction','closure','other')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','rejected','expired')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading_deg double precision,
  description text,
  occurred_at timestamptz NOT NULL,
  expires_at timestamptz,
  confirmations integer NOT NULL DEFAULT 0,
  disputes integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);

CREATE TABLE IF NOT EXISTS incident_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image','video','audio')),
  storage_key text,
  media_url text,
  sha256 text,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote text NOT NULL CHECK (vote IN ('confirm','dispute')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(incident_id, user_id)
);

CREATE TABLE IF NOT EXISTS journey_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  permissions jsonb NOT NULL DEFAULT '{"live_location":true,"journey_status":true}'::jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journeys_user_updated ON journeys(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_journeys_active ON journeys(user_id, status) WHERE status IN ('active','paused');
CREATE INDEX IF NOT EXISTS idx_journey_points_journey_time ON journey_points(journey_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_incidents_status_time ON incidents(status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_lat_lng ON incidents(lat, lng);
CREATE INDEX IF NOT EXISTS idx_incidents_expires ON incidents(expires_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON notification_outbox(status, available_at) WHERE status IN ('pending','failed');
