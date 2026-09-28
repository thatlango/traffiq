import express from 'express';
import { z } from 'zod';
import { authenticate } from './auth.js';
import { query, transaction } from './db.js';
import { previewRoute } from './geo.js';
import {
  baseConfidenceForSource,
  calculateObservationConfidence,
  categorizePlace,
  defaultExpiryForType,
  estimateVehicleRangeKm,
  h3Indexes,
  observationStatus,
  scoreStopCandidate
} from './mobility-core.js';

export const mobilityIntelligenceRouter = express.Router();

const uuid = z.string().uuid();
const coordinate = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  name: z.string().trim().min(1).max(240).optional()
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error('validation_error');
    error.status = 400;
    error.details = result.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
    throw error;
  }
  return result.data;
}

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function asNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapVehicle(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    displayName: row.display_name,
    make: row.make,
    model: row.model,
    fuelType: row.fuel_type,
    tankCapacityL: asNumber(row.tank_capacity_l),
    expectedConsumptionLPer100Km: asNumber(row.expected_consumption_l_per_100km),
    currentFuelPct: asNumber(row.current_fuel_pct),
    estimatedRangeKm: asNumber(row.estimated_range_km),
    serviceDueKm: asNumber(row.service_due_km),
    metadata: row.metadata ?? {},
    updatedAt: row.updated_at
  };
}

function mapObservation(row) {
  const confidence = calculateObservationConfidence(row);
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    severity: row.severity,
    status: row.status,
    location: { lat: Number(row.lat), lng: Number(row.lng) },
    headingDeg: asNumber(row.heading_deg),
    direction: row.direction,
    description: row.description,
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    confidence,
    confirmations: Number(row.confirmations ?? 0),
    disputes: Number(row.disputes ?? 0),
    clears: Number(row.clears ?? 0),
    h3: { r7: row.h3_r7, r8: row.h3_r8, r9: row.h3_r9 },
    distanceM: asNumber(row.distance_m),
    progressFraction: asNumber(row.progress_fraction),
    evidence: row.evidence ?? [],
    metadata: row.metadata ?? {}
  };
}

function riskSummary(observations) {
  const weights = { low: 0.25, medium: 0.5, high: 0.8, critical: 1 };
  const score = Math.min(100, Math.round(observations.reduce((sum, item) => {
    return sum + (weights[item.severity] ?? 0.5) * (item.confidence ?? 0.25) * 24;
  }, 0)));
  const level = score >= 70 ? 'high' : score >= 45 ? 'elevated' : score >= 20 ? 'moderate' : 'low';
  return {
    score,
    level,
    observationCount: observations.length,
    reasons: observations
      .filter(item => item.confidence >= 0.35)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 5)
      .map(item => ({
        observationId: item.id,
        type: item.type,
        severity: item.severity,
        confidence: item.confidence,
        progressFraction: item.progressFraction
      }))
  };
}

async function ownedPlan(userId, planId) {
  const result = await query('SELECT * FROM journey_plans WHERE id=$1 AND user_id=$2', [planId, userId]);
  if (!result.rowCount) {
    const error = new Error('journey_plan_not_found');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function selectedRouteForPlan(plan) {
  const routeId = plan.selected_route_id;
  if (!routeId) return null;
  const route = await query(
    `SELECT id, journey_plan_id, route_key, provider, profile, distance_m, duration_s,
            ST_AsGeoJSON(geometry)::json AS geometry, raw_route, risk_summary, score
       FROM route_alternatives WHERE id=$1 AND journey_plan_id=$2`,
    [routeId, plan.id]
  );
  return route.rows[0] ?? null;
}

async function observationsAlongRoute(routeId, corridorM = 1500) {
  const result = await query(
    `SELECT o.*,
            ST_Distance(o.geom::geography, r.geometry::geography) AS distance_m,
            ST_LineLocatePoint(r.geometry, ST_ClosestPoint(r.geometry, o.geom)) AS progress_fraction
       FROM mobility_observations o
       JOIN route_alternatives r ON r.id=$1
      WHERE o.status IN ('unverified','likely','confirmed')
        AND (o.expires_at IS NULL OR o.expires_at > now())
        AND ST_DWithin(o.geom::geography, r.geometry::geography, $2)
      ORDER BY o.observed_at DESC
      LIMIT 250`,
    [routeId, corridorM]
  );
  return result.rows.map(mapObservation);
}

async function refreshRecommendations(userId, planId) {
  const plan = await ownedPlan(userId, planId);
  const route = await selectedRouteForPlan(plan);
  if (!route) return [];

  const vehicleResult = plan.vehicle_id
    ? await query('SELECT * FROM vehicles WHERE id=$1 AND user_id=$2', [plan.vehicle_id, userId])
    : { rows: [] };
  const vehicle = vehicleResult.rows[0] ?? null;
  const rangeKm = estimateVehicleRangeKm(vehicle);
  const distanceKm = Number(route.distance_m) / 1000;
  const fuelTarget = rangeKm
    ? Math.max(0.20, Math.min(0.88, Math.max(20, rangeKm * 0.82) / Math.max(distanceKm, 1)))
    : 0.55;
  const corridorM = Math.max(1000, Math.min(8000, Number(plan.preferences?.corridorM ?? 3000)));

  const candidatesResult = await query(
    `SELECT p.id, p.canonical_name, p.category, p.confidence, p.verified,
            p.lat, p.lng,
            ST_Distance(p.geom::geography, r.geometry::geography) AS detour_m,
            ST_LineLocatePoint(r.geometry, ST_ClosestPoint(r.geometry, p.geom)) AS progress_fraction
       FROM traffiq_places p
       JOIN route_alternatives r ON r.id=$1
      WHERE p.visibility='public'
        AND p.geom IS NOT NULL
        AND ST_DWithin(p.geom::geography, r.geometry::geography, $2)
      ORDER BY detour_m ASC
      LIMIT 400`,
    [route.id, corridorM]
  );

  const candidates = candidatesResult.rows.map(row => {
    const stopType = categorizePlace(row.category);
    const progress = Number(row.progress_fraction ?? 0);
    const target = stopType === 'fuel' ? fuelTarget : 0.50;
    return {
      ...row,
      stopType,
      progress,
      score: scoreStopCandidate({
        stopType,
        progress,
        detourM: Number(row.detour_m),
        targetProgress: target,
        reliability: row.verified ? 1 : Number(row.confidence ?? 0.5)
      })
    };
  }).filter(row => row.stopType !== 'other');

  const selected = [];
  if (distanceKm >= 90) {
    const fuel = candidates
      .filter(item => item.stopType === 'fuel' && item.progress >= Math.max(0.12, fuelTarget - 0.22))
      .sort((a, b) => b.score - a.score)[0];
    if (fuel) selected.push({ ...fuel, target: fuelTarget, reasons: ['FUEL_RANGE','LOW_DETOUR','ROUTE_AHEAD'] });
  }

  const durationHours = Number(route.duration_s) / 3600;
  const restTargets = durationHours >= 4 ? [Math.min(0.42, 2 / durationHours), Math.min(0.82, 4 / durationHours)] :
    durationHours >= 2 ? [Math.min(0.70, 2 / durationHours)] : [];
  for (const target of restTargets) {
    const rest = candidates
      .filter(item => ['rest','food'].includes(item.stopType) && Math.abs(item.progress - target) <= 0.25)
      .map(item => ({ ...item, score: scoreStopCandidate({
        stopType: 'rest',
        progress: item.progress,
        detourM: Number(item.detour_m),
        targetProgress: target,
        reliability: item.verified ? 1 : Number(item.confidence ?? 0.5)
      }) }))
      .sort((a, b) => b.score - a.score)[0];
    if (rest && !selected.some(item => item.id === rest.id)) {
      selected.push({ ...rest, stopType: 'rest', target, reasons: ['DRIVING_DURATION','LOW_DETOUR','AMENITIES'] });
    }
  }

  await transaction(async client => {
    await client.query(
      `DELETE FROM journey_stops WHERE journey_plan_id=$1 AND recommended=true AND status='planned'`,
      [plan.id]
    );
    let sequence = 1;
    for (const item of selected.sort((a, b) => a.progress - b.progress)) {
      const distanceAlongM = Math.round(Number(route.distance_m) * item.progress);
      const eta = plan.departure_at
        ? new Date(new Date(plan.departure_at).getTime() + Number(route.duration_s) * item.progress * 1000)
        : null;
      const explanation = item.stopType === 'fuel'
        ? `Recommended fuel stop about ${Math.round(distanceAlongM / 1000)} km into the route with an estimated ${Math.round(Number(item.detour_m))} m detour.`
        : `Recommended rest stop about ${Math.round(distanceAlongM / 1000)} km into the route with an estimated ${Math.round(Number(item.detour_m))} m detour.`;
      await client.query(
        `INSERT INTO journey_stops (
           journey_plan_id, route_id, place_id, stop_type, sequence_no, progress_fraction,
           distance_along_m, detour_m, eta, recommended, score, reason_codes, explanation, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,$13::jsonb)`,
        [
          plan.id, route.id, item.id, item.stopType, sequence++, item.progress,
          distanceAlongM, Math.round(Number(item.detour_m)), eta, item.score,
          item.reasons, explanation,
          JSON.stringify({ placeName: item.canonical_name, placeCategory: item.category })
        ]
      );
    }
  });

  const refreshed = await query(
    `SELECT js.*, p.canonical_name AS place_name, p.lat AS place_lat, p.lng AS place_lng,
            p.category AS place_category, p.verified AS place_verified
       FROM journey_stops js
       LEFT JOIN traffiq_places p ON p.id=js.place_id
      WHERE js.journey_plan_id=$1
      ORDER BY js.sequence_no, js.created_at`,
    [plan.id]
  );
  return refreshed.rows;
}

async function planBundle(userId, planId) {
  const plan = await ownedPlan(userId, planId);
  const routes = await query(
    `SELECT id, route_key, provider, profile, distance_m, duration_s,
            ST_AsGeoJSON(geometry)::json AS geometry, risk_summary, score
       FROM route_alternatives WHERE journey_plan_id=$1 ORDER BY created_at`,
    [plan.id]
  );
  const stops = await query(
    `SELECT js.*, p.canonical_name AS place_name, p.lat AS place_lat, p.lng AS place_lng,
            p.category AS place_category, p.verified AS place_verified
       FROM journey_stops js
       LEFT JOIN traffiq_places p ON p.id=js.place_id
      WHERE js.journey_plan_id=$1 ORDER BY js.sequence_no, js.created_at`,
    [plan.id]
  );
  const selected = routes.rows.find(route => route.id === plan.selected_route_id) ?? null;
  const observations = selected ? await observationsAlongRoute(selected.id) : [];
  return {
    plan: {
      id: plan.id,
      clientId: plan.client_id,
      status: plan.status,
      mode: plan.mode,
      origin: { name: plan.origin_name, lat: Number(plan.origin_lat), lng: Number(plan.origin_lng) },
      destination: { name: plan.destination_name, lat: Number(plan.destination_lat), lng: Number(plan.destination_lng) },
      departureAt: plan.departure_at,
      vehicleId: plan.vehicle_id,
      travellerContext: plan.traveller_context ?? {},
      preferences: plan.preferences ?? {},
      selectedRouteId: plan.selected_route_id,
      intelligenceVersion: plan.intelligence_version,
      updatedAt: plan.updated_at
    },
    routes: routes.rows.map(row => ({
      id: row.id,
      routeKey: row.route_key,
      provider: row.provider,
      profile: row.profile,
      distanceM: Number(row.distance_m),
      durationS: Number(row.duration_s),
      geometry: row.geometry,
      riskSummary: row.risk_summary ?? {},
      score: asNumber(row.score)
    })),
    stops: stops.rows.map(row => ({
      id: row.id,
      routeId: row.route_id,
      stopType: row.stop_type,
      status: row.status,
      sequence: row.sequence_no,
      progressFraction: asNumber(row.progress_fraction),
      distanceAlongM: row.distance_along_m,
      detourM: row.detour_m,
      eta: row.eta,
      recommended: row.recommended,
      score: asNumber(row.score),
      reasonCodes: row.reason_codes ?? [],
      explanation: row.explanation,
      place: row.place_id ? {
        id: row.place_id,
        name: row.place_name,
        category: row.place_category,
        lat: Number(row.place_lat),
        lng: Number(row.place_lng),
        verified: Boolean(row.place_verified)
      } : null
    })),
    intelligence: {
      risk: riskSummary(observations),
      observations
    }
  };
}

mobilityIntelligenceRouter.get('/intelligence/capabilities', (_req, res) => {
  res.json({
    contractVersion: '2026-09-28.v1',
    platforms: ['web','android','ios'],
    spatial: { engine: 'postgis', h3Resolutions: [7,8,9], routeCorridors: true },
    offline: { idempotentClientEvents: true, observationReports: true },
    journey: { plans: true, routeAlternatives: true, recommendedStops: true, risk: true, replanningContract: true }
  });
});

mobilityIntelligenceRouter.get('/vehicles', authenticate, asyncRoute(async (req, res) => {
  const result = await query('SELECT * FROM vehicles WHERE user_id=$1 ORDER BY updated_at DESC', [req.user.id]);
  res.json({ vehicles: result.rows.map(mapVehicle) });
}));

mobilityIntelligenceRouter.post('/vehicles', authenticate, asyncRoute(async (req, res) => {
  const body = parse(z.object({
    clientId: uuid,
    displayName: z.string().trim().min(1).max(120),
    make: z.string().trim().max(120).optional(),
    model: z.string().trim().max(120).optional(),
    fuelType: z.enum(['petrol','diesel','hybrid','electric','other']).optional(),
    tankCapacityL: z.number().positive().max(1000).optional(),
    expectedConsumptionLPer100Km: z.number().positive().max(200).optional(),
    currentFuelPct: z.number().min(0).max(100).optional(),
    estimatedRangeKm: z.number().nonnegative().max(10000).optional(),
    serviceDueKm: z.number().nonnegative().max(1000000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  }), req.body);
  const result = await query(
    `INSERT INTO vehicles (
       user_id, client_id, display_name, make, model, fuel_type, tank_capacity_l,
       expected_consumption_l_per_100km, current_fuel_pct, estimated_range_km, service_due_km, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (user_id, client_id) DO UPDATE SET
       display_name=EXCLUDED.display_name, make=EXCLUDED.make, model=EXCLUDED.model,
       fuel_type=EXCLUDED.fuel_type, tank_capacity_l=EXCLUDED.tank_capacity_l,
       expected_consumption_l_per_100km=EXCLUDED.expected_consumption_l_per_100km,
       current_fuel_pct=EXCLUDED.current_fuel_pct, estimated_range_km=EXCLUDED.estimated_range_km,
       service_due_km=EXCLUDED.service_due_km, metadata=EXCLUDED.metadata, updated_at=now()
     RETURNING *`,
    [
      req.user.id, body.clientId, body.displayName, body.make ?? null, body.model ?? null,
      body.fuelType ?? 'petrol', body.tankCapacityL ?? null, body.expectedConsumptionLPer100Km ?? null,
      body.currentFuelPct ?? null, body.estimatedRangeKm ?? null, body.serviceDueKm ?? null,
      JSON.stringify(body.metadata ?? {})
    ]
  );
  res.status(201).json({ vehicle: mapVehicle(result.rows[0]) });
}));

mobilityIntelligenceRouter.post('/journey-plans', authenticate, asyncRoute(async (req, res) => {
  const body = parse(z.object({
    clientId: uuid,
    mode: z.enum(['car','motorcycle','taxi','bus','truck','bicycle','walking','other']),
    origin: coordinate,
    destination: coordinate,
    departureAt: z.string().datetime({ offset: true }).optional(),
    vehicleId: uuid.optional(),
    travellerContext: z.record(z.string(), z.unknown()).optional(),
    preferences: z.record(z.string(), z.unknown()).optional()
  }), req.body);
  if (body.vehicleId) {
    const vehicle = await query('SELECT id FROM vehicles WHERE id=$1 AND user_id=$2', [body.vehicleId, req.user.id]);
    if (!vehicle.rowCount) return res.status(404).json({ error: 'vehicle_not_found' });
  }

  const existing = await query('SELECT id FROM journey_plans WHERE user_id=$1 AND client_id=$2', [req.user.id, body.clientId]);
  if (existing.rowCount) return res.json(await planBundle(req.user.id, existing.rows[0].id));

  const preview = await previewRoute({
    originLat: body.origin.lat,
    originLng: body.origin.lng,
    destinationLat: body.destination.lat,
    destinationLng: body.destination.lng,
    mode: body.mode
  });

  const planId = await transaction(async client => {
    const inserted = await client.query(
      `INSERT INTO journey_plans (
         user_id, client_id, mode, origin_name, origin_lat, origin_lng,
         destination_name, destination_lat, destination_lng, departure_at,
         vehicle_id, traveller_context, preferences
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
       RETURNING id`,
      [
        req.user.id, body.clientId, body.mode, body.origin.name ?? null, body.origin.lat, body.origin.lng,
        body.destination.name ?? null, body.destination.lat, body.destination.lng, body.departureAt ?? null,
        body.vehicleId ?? null, JSON.stringify(body.travellerContext ?? {}), JSON.stringify(body.preferences ?? {})
      ]
    );
    const id = inserted.rows[0].id;
    let selectedRouteId = null;
    for (const route of preview.routes) {
      const routeInsert = await client.query(
        `INSERT INTO route_alternatives (
           journey_plan_id, route_key, provider, profile, distance_m, duration_s, geometry, raw_route
         ) VALUES ($1,$2,$3,$4,$5,$6,ST_SetSRID(ST_GeomFromGeoJSON($7),4326),$8::jsonb)
         RETURNING id`,
        [
          id, route.id, preview.provider, preview.profile, route.distanceM, route.durationS,
          JSON.stringify(route.geometry), JSON.stringify(route)
        ]
      );
      if (!selectedRouteId) selectedRouteId = routeInsert.rows[0].id;
    }
    await client.query(
      `UPDATE journey_plans SET selected_route_id=$2, status='ready', updated_at=now() WHERE id=$1`,
      [id, selectedRouteId]
    );
    return id;
  });

  await refreshRecommendations(req.user.id, planId);
  res.status(201).json(await planBundle(req.user.id, planId));
}));

mobilityIntelligenceRouter.get('/journey-plans/:id', authenticate, asyncRoute(async (req, res) => {
  res.json(await planBundle(req.user.id, parse(uuid, req.params.id)));
}));

mobilityIntelligenceRouter.post('/journey-plans/:id/select-route', authenticate, asyncRoute(async (req, res) => {
  const planId = parse(uuid, req.params.id);
  const body = parse(z.object({ routeId: uuid }), req.body);
  await ownedPlan(req.user.id, planId);
  const route = await query('SELECT id FROM route_alternatives WHERE id=$1 AND journey_plan_id=$2', [body.routeId, planId]);
  if (!route.rowCount) return res.status(404).json({ error: 'route_not_found' });
  await query('UPDATE journey_plans SET selected_route_id=$2, intelligence_version=intelligence_version+1, updated_at=now() WHERE id=$1', [planId, body.routeId]);
  await refreshRecommendations(req.user.id, planId);
  res.json(await planBundle(req.user.id, planId));
}));

mobilityIntelligenceRouter.post('/journey-plans/:id/recommendations/refresh', authenticate, asyncRoute(async (req, res) => {
  const planId = parse(uuid, req.params.id);
  await refreshRecommendations(req.user.id, planId);
  res.json(await planBundle(req.user.id, planId));
}));

mobilityIntelligenceRouter.post('/journey-plans/:id/activate', authenticate, asyncRoute(async (req, res) => {
  const planId = parse(uuid, req.params.id);
  const body = parse(z.object({ journeyClientId: uuid }), req.body);
  const plan = await ownedPlan(req.user.id, planId);
  const route = await selectedRouteForPlan(plan);
  if (!route) return res.status(409).json({ error: 'route_not_selected' });

  const result = await query(
    `INSERT INTO journeys (
       user_id, client_id, mode, status, origin_name, origin_lat, origin_lng,
       destination_name, destination_lat, destination_lng, route_provider,
       planned_distance_m, planned_duration_s, journey_plan_id, route_geometry
     ) VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
       ST_SetSRID(ST_GeomFromGeoJSON($14),4326))
     ON CONFLICT (user_id, client_id) DO UPDATE SET updated_at=journeys.updated_at
     RETURNING *`,
    [
      req.user.id, body.journeyClientId, plan.mode, plan.origin_name, plan.origin_lat, plan.origin_lng,
      plan.destination_name, plan.destination_lat, plan.destination_lng, route.provider,
      route.distance_m, route.duration_s, plan.id, JSON.stringify(route.geometry)
    ]
  );
  await query("UPDATE journey_plans SET status='active', updated_at=now() WHERE id=$1", [plan.id]);
  res.status(201).json({ journey: result.rows[0], plan: (await planBundle(req.user.id, plan.id)).plan });
}));

const observationType = z.enum([
  'crash','traffic','pothole','flooding','roadblock','roadworks','broken_vehicle',
  'debris','bad_road','fuel_unavailable','police_checkpoint','unsafe_area',
  'road_closure','animal','harsh_braking','slowdown','road_damage','other'
]);

mobilityIntelligenceRouter.post('/observations', authenticate, asyncRoute(async (req, res) => {
  const body = parse(z.object({
    clientId: uuid,
    journeyId: uuid.optional(),
    type: observationType,
    source: z.enum(['community','sensor']).optional(),
    severity: z.enum(['low','medium','high','critical']).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    headingDeg: z.number().min(0).max(360).optional(),
    direction: z.string().trim().max(80).optional(),
    description: z.string().trim().max(1000).optional(),
    observedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    evidence: z.array(z.record(z.string(), z.unknown())).max(8).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  }), req.body);
  if (body.journeyId) {
    const owned = await query('SELECT id FROM journeys WHERE id=$1 AND user_id=$2', [body.journeyId, req.user.id]);
    if (!owned.rowCount) return res.status(404).json({ error: 'journey_not_found' });
  }

  const replay = await query(
    `SELECT o.* FROM mobility_observation_reports r
       JOIN mobility_observations o ON o.id=r.observation_id
      WHERE r.user_id=$1 AND r.client_id=$2 LIMIT 1`,
    [req.user.id, body.clientId]
  );
  if (replay.rowCount) return res.json({ merged: true, idempotentReplay: true, observation: mapObservation(replay.rows[0]) });

  const source = body.source ?? 'community';
  const observedAt = new Date(body.observedAt);
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : defaultExpiryForType(body.type, observedAt);
  const h3 = h3Indexes(body.lat, body.lng);
  const mergeHours = ['pothole','bad_road','road_damage','roadworks'].includes(body.type) ? 24 * 14 : 3;
  const mergeRadiusM = ['traffic','crash','roadblock','debris','broken_vehicle'].includes(body.type) ? 600 : 250;

  const duplicate = await query(
    `SELECT * FROM mobility_observations
      WHERE type=$1
        AND status IN ('unverified','likely','confirmed')
        AND observed_at > now() - make_interval(hours => $2)
        AND (expires_at IS NULL OR expires_at > now())
        AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5)
      ORDER BY geom <-> ST_SetSRID(ST_MakePoint($3,$4),4326), observed_at DESC
      LIMIT 1`,
    [body.type, mergeHours, body.lng, body.lat, mergeRadiusM]
  );

  const observation = await transaction(async client => {
    let row;
    if (duplicate.rowCount) {
      row = duplicate.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO mobility_observations (
           created_by, journey_id, client_id, type, source, severity, lat, lng, heading_deg,
           direction, description, observed_at, expires_at, base_confidence,
           h3_r7, h3_r8, h3_r9, evidence, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb)
         RETURNING *`,
        [
          req.user.id, body.journeyId ?? null, body.clientId, body.type, source, body.severity ?? 'medium',
          body.lat, body.lng, body.headingDeg ?? null, body.direction ?? null, body.description ?? null,
          body.observedAt, expiresAt, baseConfidenceForSource(source), h3.r7, h3.r8, h3.r9,
          JSON.stringify(body.evidence ?? []), JSON.stringify(body.metadata ?? {})
        ]
      );
      row = inserted.rows[0];
    }

    await client.query(
      `INSERT INTO mobility_observation_reports (
         observation_id, user_id, client_id, lat, lng, description, observed_at, evidence, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
       ON CONFLICT (user_id, client_id) DO NOTHING`,
      [
        row.id, req.user.id, body.clientId, body.lat, body.lng, body.description ?? null, body.observedAt,
        JSON.stringify(body.evidence ?? []), JSON.stringify(body.metadata ?? {})
      ]
    );

    if (duplicate.rowCount && row.created_by !== req.user.id) {
      await client.query(
        `INSERT INTO mobility_observation_votes (observation_id,user_id,vote)
         VALUES ($1,$2,'confirm')
         ON CONFLICT (observation_id,user_id) DO UPDATE SET vote='confirm',updated_at=now()`,
        [row.id, req.user.id]
      );
    }

    const counts = await client.query(
      `SELECT
         count(*) FILTER (WHERE vote='confirm')::int AS confirmations,
         count(*) FILTER (WHERE vote='dispute')::int AS disputes,
         count(*) FILTER (WHERE vote='clear')::int AS clears
       FROM mobility_observation_votes WHERE observation_id=$1`,
      [row.id]
    );
    const current = { ...row, ...counts.rows[0] };
    const confidence = calculateObservationConfidence(current);
    const status = observationStatus({
      confidence,
      confirmations: Number(current.confirmations),
      disputes: Number(current.disputes),
      clears: Number(current.clears),
      expired: new Date(expiresAt) <= new Date()
    });
    const updated = await client.query(
      `UPDATE mobility_observations SET confirmations=$2,disputes=$3,clears=$4,status=$5,
         expires_at=GREATEST(COALESCE(expires_at,$6),$6),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [row.id, current.confirmations, current.disputes, current.clears, status, expiresAt]
    );
    return updated.rows[0];
  });

  res.status(duplicate.rowCount ? 200 : 201).json({
    merged: Boolean(duplicate.rowCount),
    observation: mapObservation(observation)
  });
}));

mobilityIntelligenceRouter.get('/observations/nearby', authenticate, asyncRoute(async (req, res) => {
  const params = parse(z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusM: z.coerce.number().int().min(100).max(50000).optional(),
    types: z.string().optional()
  }), req.query);
  const radius = params.radiusM ?? 10000;
  await query(
    `UPDATE mobility_observations SET status='expired',updated_at=now()
      WHERE status IN ('unverified','likely','confirmed') AND expires_at IS NOT NULL AND expires_at <= now()`
  );
  const types = params.types ? params.types.split(',').map(v => v.trim()).filter(Boolean) : null;
  const result = await query(
    `SELECT o.*, ST_Distance(o.geom::geography, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography) AS distance_m
       FROM mobility_observations o
      WHERE o.status IN ('unverified','likely','confirmed')
        AND (o.expires_at IS NULL OR o.expires_at > now())
        AND ST_DWithin(o.geom::geography, ST_SetSRID(ST_MakePoint($2,$1),4326)::geography, $3)
        AND ($4::text[] IS NULL OR o.type = ANY($4::text[]))
      ORDER BY o.geom <-> ST_SetSRID(ST_MakePoint($2,$1),4326), o.observed_at DESC
      LIMIT 250`,
    [params.lat, params.lng, radius, types]
  );
  res.json({ observations: result.rows.map(mapObservation), radiusM: radius, serverTime: new Date().toISOString() });
}));

mobilityIntelligenceRouter.put('/observations/:id/vote', authenticate, asyncRoute(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(z.object({ vote: z.enum(['confirm','dispute','clear']) }), req.body);
  const updated = await transaction(async client => {
    const found = await client.query('SELECT * FROM mobility_observations WHERE id=$1', [id]);
    if (!found.rowCount) {
      const error = new Error('observation_not_found');
      error.status = 404;
      throw error;
    }
    await client.query(
      `INSERT INTO mobility_observation_votes (observation_id,user_id,vote)
       VALUES ($1,$2,$3)
       ON CONFLICT (observation_id,user_id) DO UPDATE SET vote=EXCLUDED.vote,updated_at=now()`,
      [id, req.user.id, body.vote]
    );
    const counts = await client.query(
      `SELECT
         count(*) FILTER (WHERE vote='confirm')::int AS confirmations,
         count(*) FILTER (WHERE vote='dispute')::int AS disputes,
         count(*) FILTER (WHERE vote='clear')::int AS clears
       FROM mobility_observation_votes WHERE observation_id=$1`,
      [id]
    );
    const current = { ...found.rows[0], ...counts.rows[0] };
    const confidence = calculateObservationConfidence(current);
    const status = observationStatus({
      confidence,
      confirmations: Number(current.confirmations),
      disputes: Number(current.disputes),
      clears: Number(current.clears),
      expired: current.expires_at && new Date(current.expires_at) <= new Date()
    });
    const result = await client.query(
      `UPDATE mobility_observations SET confirmations=$2,disputes=$3,clears=$4,status=$5,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, current.confirmations, current.disputes, current.clears, status]
    );
    return result.rows[0];
  });
  res.json({ vote: body.vote, observation: mapObservation(updated) });
}));

mobilityIntelligenceRouter.post('/client-events/batch', authenticate, asyncRoute(async (req, res) => {
  const body = parse(z.object({
    deviceId: uuid.optional(),
    events: z.array(z.object({
      id: uuid,
      type: z.string().trim().min(1).max(120),
      occurredAt: z.string().datetime({ offset: true }),
      payload: z.record(z.string(), z.unknown()).optional()
    })).min(1).max(200)
  }), req.body);
  if (body.deviceId) {
    const device = await query('SELECT id FROM devices WHERE id=$1 AND user_id=$2', [body.deviceId, req.user.id]);
    if (!device.rowCount) return res.status(404).json({ error: 'device_not_found' });
  }
  const result = await query(
    `INSERT INTO client_events (user_id,device_id,client_event_id,event_type,occurred_at,payload)
     SELECT $1,$2,e.id::uuid,e.type,e.occurred_at::timestamptz,COALESCE(e.payload,'{}'::jsonb)
       FROM jsonb_to_recordset($3::jsonb) AS e(id text,type text,occurred_at text,payload jsonb)
     ON CONFLICT (user_id,client_event_id) DO NOTHING
     RETURNING client_event_id`,
    [
      req.user.id,
      body.deviceId ?? null,
      JSON.stringify(body.events.map(event => ({
        id: event.id, type: event.type, occurred_at: event.occurredAt, payload: event.payload ?? {}
      })))
    ]
  );
  res.status(202).json({
    accepted: result.rowCount,
    duplicateOrExisting: body.events.length - result.rowCount,
    acceptedIds: result.rows.map(row => row.client_event_id),
    serverTime: new Date().toISOString()
  });
}));
