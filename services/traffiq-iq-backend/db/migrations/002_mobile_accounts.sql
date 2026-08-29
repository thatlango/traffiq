ALTER TABLE users ADD COLUMN IF NOT EXISTS google_subject text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'custom',
  formatted_address text,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  provider_place_id text,
  is_favorite boolean NOT NULL DEFAULT false,
  is_suggested boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_places_user ON saved_places(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS trusted_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  relationship text,
  note text,
  invite_status text NOT NULL DEFAULT 'pending',
  invite_token_hash text UNIQUE,
  invite_expires_at timestamptz,
  can_view_live_trips boolean NOT NULL DEFAULT true,
  can_receive_emergency_alerts boolean NOT NULL DEFAULT true,
  can_receive_incident_updates boolean NOT NULL DEFAULT true,
  is_default_share_contact boolean NOT NULL DEFAULT false,
  is_emergency_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trusted_people_user ON trusted_people(user_id, created_at DESC);

ALTER TABLE journeys ADD COLUMN IF NOT EXISTS journey_role text;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'personal';
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS prefer_safe boolean NOT NULL DEFAULT false;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS prefer_paved boolean NOT NULL DEFAULT false;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS end_reason text;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_password_reset_active ON password_reset_tokens(user_id, expires_at) WHERE used_at IS NULL;
