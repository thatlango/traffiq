-- Add reckless-driving observations as a first-class TraffIQ incident type.
-- Reports remain community observations and require corroboration before enforcement use.
ALTER TABLE incidents
  DROP CONSTRAINT IF EXISTS incidents_type_check;

ALTER TABLE incidents
  ADD CONSTRAINT incidents_type_check
  CHECK (type IN (
    'accident',
    'hazard',
    'roadblock',
    'police',
    'traffic',
    'road_damage',
    'flooding',
    'construction',
    'closure',
    'reckless_driving',
    'other'
  ));
