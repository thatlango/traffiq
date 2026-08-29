CREATE TABLE IF NOT EXISTS live_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  display_name text,
  lat double precision,
  lng double precision,
  accuracy double precision,
  heading double precision,
  speed double precision,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS live_shares_user_active_idx
  ON live_shares(user_id, active, expires_at DESC);
CREATE INDEX IF NOT EXISTS live_shares_expiry_idx
  ON live_shares(expires_at);
