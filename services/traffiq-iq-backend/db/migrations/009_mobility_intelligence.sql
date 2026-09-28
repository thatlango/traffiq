CREATE EXTENSION IF NOT EXISTS postgis;

-- Spatialize the existing operational records without changing their public contracts.
ALTER TABLE journey_points
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  ADD COLUMN IF NOT EXISTS h3_r7 text,
  ADD COLUMN IF NOT EXISTS h3_r8 text,
  ADD COLUMN IF NOT EXISTS h3_r9 text;

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  ADD COLUMN IF NOT EXISTS h3_r7 text,
  ADD COLUMN IF NOT EXISTS h3_r8 text,
  ADD COLUMN IF NOT EXISTS h3_r9 text;

ALTER TABLE traffiq_places
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
  GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  ADD COLUMN IF NOT EXISTS h3_r7 text,
  ADD COLUMN IF NOT EXISTS h3_r8 text,
  ADD COLUMN IF NOT EXISTS h3_r9 text;

CREATE INDEX IF NOT EXISTS idx_journey_points_geom ON journey_points USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_incidents_geom ON incidents USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_traffiq_places_geom ON traffiq_places USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_journey_points_h3_r8 ON journey_points(h3_r8) WHERE h3_r8 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_h3_r8 ON incidents(h3_r8) WHERE h3_r8 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_traffiq_places_h3_r8 ON traffiq_places(h3_r8) WHERE h3_r8 IS NOT NULL;

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  display_name text NOT NULL,
  make text,
  model text,
  fuel_type text NOT NULL DEFAULT 'petrol'
    CHECK (fuel_type IN ('petrol','diesel','hybrid','electric','other')),
  tank_capacity_l numeric(8,2),
  expected_consumption_l_per_100km numeric(8,3),
  current_fuel_pct numeric(5,2) CHECK (current_fuel_pct IS NULL OR current_fuel_pct BETWEEN 0 AND 100),
  estimated_range_km numeric(10,2),
  service_due_km numeric(12,2),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS journey_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('draft','planned','ready','active','completed','cancelled','abandoned')),
  mode text NOT NULL CHECK (mode IN ('car','motorcycle','taxi','bus','truck','bicycle','walking','other')),
  origin_name text,
  origin_lat double precision NOT NULL CHECK (origin_lat BETWEEN -90 AND 90),
  origin_lng double precision NOT NULL CHECK (origin_lng BETWEEN -180 AND 180),
  destination_name text,
  destination_lat double precision NOT NULL CHECK (destination_lat BETWEEN -90 AND 90),
  destination_lng double precision NOT NULL CHECK (destination_lng BETWEEN -180 AND 180),
  departure_at timestamptz,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  traveller_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_route_id uuid,
  intelligence_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_journey_plans_user ON journey_plans(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_plans_active ON journey_plans(user_id, status)
  WHERE status IN ('planned','ready','active');

CREATE TABLE IF NOT EXISTS route_alternatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_plan_id uuid NOT NULL REFERENCES journey_plans(id) ON DELETE CASCADE,
  route_key text NOT NULL,
  provider text NOT NULL,
  profile text,
  distance_m integer NOT NULL CHECK (distance_m >= 0),
  duration_s integer NOT NULL CHECK (duration_s >= 0),
  geometry geometry(LineString, 4326) NOT NULL,
  raw_route jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric(8,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(journey_plan_id, route_key)
);
CREATE INDEX IF NOT EXISTS idx_route_alternatives_plan ON route_alternatives(journey_plan_id);
CREATE INDEX IF NOT EXISTS idx_route_alternatives_geom ON route_alternatives USING gist (geometry);

DO $$ BEGIN
  ALTER TABLE journey_plans
    ADD CONSTRAINT journey_plans_selected_route_fk
    FOREIGN KEY (selected_route_id) REFERENCES route_alternatives(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS road_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'traffiq',
  source_ref text,
  name text,
  road_class text,
  directionality text NOT NULL DEFAULT 'both'
    CHECK (directionality IN ('both','forward','reverse','unknown')),
  geometry geometry(LineString, 4326) NOT NULL,
  h3_r7 text,
  h3_r8 text,
  h3_r9 text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_road_segments_geom ON road_segments USING gist (geometry);
CREATE INDEX IF NOT EXISTS idx_road_segments_h3_r8 ON road_segments(h3_r8) WHERE h3_r8 IS NOT NULL;

CREATE TABLE IF NOT EXISTS journey_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_plan_id uuid NOT NULL REFERENCES journey_plans(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES route_alternatives(id) ON DELETE CASCADE,
  place_id uuid REFERENCES traffiq_places(id) ON DELETE SET NULL,
  stop_type text NOT NULL
    CHECK (stop_type IN ('fuel','rest','food','health','vehicle_service','accommodation','cash','emergency','charging','other')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','accepted','skipped','completed','cancelled')),
  sequence_no integer NOT NULL DEFAULT 0,
  progress_fraction numeric(7,6) CHECK (progress_fraction IS NULL OR progress_fraction BETWEEN 0 AND 1),
  distance_along_m integer,
  detour_m integer,
  eta timestamptz,
  recommended boolean NOT NULL DEFAULT true,
  score numeric(8,3),
  reason_codes text[] NOT NULL DEFAULT '{}'::text[],
  explanation text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_stops_plan ON journey_stops(journey_plan_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_journey_stops_route ON journey_stops(route_id, sequence_no);

CREATE TABLE IF NOT EXISTS mobility_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  journey_id uuid REFERENCES journeys(id) ON DELETE SET NULL,
  client_id uuid,
  type text NOT NULL CHECK (type IN (
    'crash','traffic','pothole','flooding','roadblock','roadworks','broken_vehicle',
    'debris','bad_road','fuel_unavailable','police_checkpoint','unsafe_area',
    'road_closure','animal','harsh_braking','slowdown','road_damage','other'
  )),
  source text NOT NULL DEFAULT 'community'
    CHECK (source IN ('community','sensor','inferred','partner','official','third_party')),
  severity text NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','likely','confirmed','resolved','expired','disputed','rejected')),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  geom geometry(Point, 4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  heading_deg double precision,
  direction text,
  road_segment_id uuid REFERENCES road_segments(id) ON DELETE SET NULL,
  description text,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz,
  base_confidence numeric(5,4) NOT NULL DEFAULT 0.25 CHECK (base_confidence BETWEEN 0 AND 1),
  confirmations integer NOT NULL DEFAULT 0,
  disputes integer NOT NULL DEFAULT 0,
  clears integer NOT NULL DEFAULT 0,
  h3_r7 text,
  h3_r8 text,
  h3_r9 text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mobility_observation_client
  ON mobility_observations(created_by, client_id) WHERE created_by IS NOT NULL AND client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mobility_observations_geom ON mobility_observations USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_mobility_observations_active
  ON mobility_observations(status, observed_at DESC)
  WHERE status IN ('unverified','likely','confirmed');
CREATE INDEX IF NOT EXISTS idx_mobility_observations_expiry
  ON mobility_observations(expires_at)
  WHERE status IN ('unverified','likely','confirmed');
CREATE INDEX IF NOT EXISTS idx_mobility_observations_h3_r8
  ON mobility_observations(h3_r8) WHERE h3_r8 IS NOT NULL;

CREATE TABLE IF NOT EXISTS mobility_observation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid NOT NULL REFERENCES mobility_observations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  description text,
  observed_at timestamptz NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_observation_reports_observation
  ON mobility_observation_reports(observation_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS mobility_observation_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid NOT NULL REFERENCES mobility_observations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote text NOT NULL CHECK (vote IN ('confirm','dispute','clear')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(observation_id, user_id)
);

CREATE TABLE IF NOT EXISTS client_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  client_event_id uuid NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, client_event_id)
);
CREATE INDEX IF NOT EXISTS idx_client_events_user_time ON client_events(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS journey_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id uuid REFERENCES journeys(id) ON DELETE CASCADE,
  journey_plan_id uuid REFERENCES journey_plans(id) ON DELETE CASCADE,
  observation_id uuid REFERENCES mobility_observations(id) ON DELETE SET NULL,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'information'
    CHECK (severity IN ('information','caution','important','critical')),
  title text NOT NULL,
  body text,
  action jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','acknowledged','dismissed','expired')),
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_alerts_pending
  ON journey_alerts(user_id, status, available_at)
  WHERE status IN ('pending','delivered');

ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS journey_plan_id uuid REFERENCES journey_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_geometry geometry(LineString, 4326);

CREATE INDEX IF NOT EXISTS idx_journeys_route_geometry ON journeys USING gist(route_geometry);
