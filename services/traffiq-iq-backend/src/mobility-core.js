import { latLngToCell } from 'h3-js';

const EXPIRY_MINUTES = Object.freeze({
  traffic: 90,
  crash: 360,
  pothole: 60 * 24 * 60,
  flooding: 24 * 60,
  roadblock: 6 * 60,
  roadworks: 7 * 24 * 60,
  broken_vehicle: 4 * 60,
  debris: 6 * 60,
  bad_road: 30 * 24 * 60,
  fuel_unavailable: 12 * 60,
  police_checkpoint: 3 * 60,
  unsafe_area: 24 * 60,
  road_closure: 24 * 60,
  animal: 120,
  harsh_braking: 60,
  slowdown: 60,
  road_damage: 60 * 24 * 60,
  other: 6 * 60
});

export function h3Indexes(lat, lng) {
  return {
    r7: latLngToCell(lat, lng, 7),
    r8: latLngToCell(lat, lng, 8),
    r9: latLngToCell(lat, lng, 9)
  };
}

export function defaultExpiryForType(type, observedAt = new Date()) {
  const minutes = EXPIRY_MINUTES[type] ?? EXPIRY_MINUTES.other;
  return new Date(new Date(observedAt).getTime() + minutes * 60_000);
}

export function baseConfidenceForSource(source) {
  return ({
    community: 0.25,
    sensor: 0.35,
    inferred: 0.20,
    partner: 0.65,
    official: 0.90,
    third_party: 0.50
  })[source] ?? 0.25;
}

export function calculateObservationConfidence(observation, at = new Date()) {
  const base = Number(observation.base_confidence ?? observation.baseConfidence ?? 0.25);
  const confirmations = Number(observation.confirmations ?? 0);
  const disputes = Number(observation.disputes ?? 0);
  const raw = Math.max(0, Math.min(1, base + confirmations * 0.12 - disputes * 0.18));
  const observed = new Date(observation.observed_at ?? observation.observedAt ?? at);
  const expires = observation.expires_at ?? observation.expiresAt;
  if (!expires) return raw;
  const end = new Date(expires);
  const total = Math.max(1, end.getTime() - observed.getTime());
  const remaining = Math.max(0, end.getTime() - new Date(at).getTime());
  const freshness = Math.max(0.20, Math.min(1, remaining / total));
  return Math.max(0, Math.min(1, raw * freshness));
}

export function observationStatus({ confidence, confirmations = 0, disputes = 0, clears = 0, expired = false }) {
  if (expired) return 'expired';
  if (clears >= 2 && clears >= confirmations) return 'resolved';
  if (disputes >= 3 && disputes > confirmations) return 'disputed';
  if (confirmations >= 2 && confidence >= 0.60) return 'confirmed';
  if (confirmations >= 1 || confidence >= 0.40) return 'likely';
  return 'unverified';
}

export function categorizePlace(category = '') {
  const value = String(category).toLowerCase();
  if (/fuel|gas_station|petrol/.test(value)) return 'fuel';
  if (/ev_|charging/.test(value)) return 'charging';
  if (/restaurant|cafe|food|rest_area/.test(value)) return 'rest';
  if (/hospital|clinic|pharmacy|health/.test(value)) return 'health';
  if (/car_repair|mechanic|tyre|tire|vehicle/.test(value)) return 'vehicle_service';
  if (/hotel|lodging|motel|accommodation/.test(value)) return 'accommodation';
  if (/atm|bank|cash/.test(value)) return 'cash';
  if (/police|emergency/.test(value)) return 'emergency';
  return 'other';
}

export function estimateVehicleRangeKm(vehicle) {
  const explicit = Number(vehicle?.estimated_range_km ?? vehicle?.estimatedRangeKm);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const tank = Number(vehicle?.tank_capacity_l ?? vehicle?.tankCapacityL);
  const consumption = Number(vehicle?.expected_consumption_l_per_100km ?? vehicle?.expectedConsumptionLPer100Km);
  const fuelPct = Number(vehicle?.current_fuel_pct ?? vehicle?.currentFuelPct);
  if (![tank, consumption, fuelPct].every(Number.isFinite) || tank <= 0 || consumption <= 0 || fuelPct < 0) return null;
  return (tank * (fuelPct / 100) / consumption) * 100;
}

export function scoreStopCandidate({ stopType, progress, detourM, targetProgress = 0.55, reliability = 0.5 }) {
  const detourPenalty = Math.min(45, Math.max(0, Number(detourM) || 0) / 1000 * 8);
  const progressPenalty = Math.abs((Number(progress) || 0) - targetProgress) * 55;
  const reliabilityBonus = Math.max(0, Math.min(1, Number(reliability) || 0)) * 12;
  const typeBonus = stopType === 'fuel' ? 8 : stopType === 'rest' ? 5 : 0;
  return Math.max(0, Math.min(120, 100 - detourPenalty - progressPenalty + reliabilityBonus + typeBonus));
}


export function shouldReplanJourney({
  offRouteDistanceM,
  force = false,
  thresholdM = 200
} = {}) {
  if (force) return true;
  const distance = Number(offRouteDistanceM);
  const threshold = Math.max(25, Number(thresholdM) || 200);
  return Number.isFinite(distance) && distance > threshold;
}


export function buildJourneyAlerts({
  observations = [],
  stops = [],
  currentProgressFraction = 0,
  routeDistanceM = 0,
  maxHazards = 3,
  maxStops = 2
} = {}) {
  const progress = Math.max(0, Math.min(1, Number(currentProgressFraction) || 0));
  const distance = Math.max(0, Number(routeDistanceM) || 0);

  const hazardAlerts = observations
    .filter(item => {
      const itemProgress = Number(item.progressFraction);
      const confidence = Number(item.confidence ?? 0);
      return Number.isFinite(itemProgress) &&
        itemProgress >= progress - 0.01 &&
        confidence >= 0.35 &&
        !['resolved', 'expired', 'disputed'].includes(String(item.status || '').toLowerCase());
    })
    .map(item => {
      const aheadFraction = Math.max(0, Number(item.progressFraction) - progress);
      const distanceAheadM = distance > 0 ? Math.round(aheadFraction * distance) : null;
      const label = String(item.type || 'road hazard').replaceAll('_', ' ');
      return {
        id: `hazard:${item.id}`,
        kind: 'hazard',
        severity: item.severity ?? 'medium',
        title: `${label.charAt(0).toUpperCase() + label.slice(1)} ahead`,
        message: distanceAheadM === null
          ? `${Math.round(Number(item.confidence ?? 0) * 100)}% confidence from current road reports.`
          : `${Math.max(0, Math.round(distanceAheadM / 100) * 100)} m ahead · ${Math.round(Number(item.confidence ?? 0) * 100)}% confidence.`,
        progressFraction: Number(item.progressFraction),
        distanceAheadM,
        confidence: Number(item.confidence ?? 0),
        observationId: item.id,
        stopId: null
      };
    })
    .sort((a, b) => {
      const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
      const severityDiff = (severityWeight[b.severity] ?? 0) - (severityWeight[a.severity] ?? 0);
      return severityDiff || (a.distanceAheadM ?? Number.MAX_SAFE_INTEGER) - (b.distanceAheadM ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, Math.max(0, Number(maxHazards) || 0));

  const stopAlerts = stops
    .filter(stop => {
      const stopProgress = Number(stop.progressFraction);
      return stop.recommended !== false &&
        Number.isFinite(stopProgress) &&
        stopProgress >= progress - 0.005 &&
        ['planned', 'accepted'].includes(String(stop.status || 'planned'));
    })
    .map(stop => {
      const aheadFraction = Math.max(0, Number(stop.progressFraction) - progress);
      const distanceAheadM = Number.isFinite(Number(stop.distanceAlongM)) && distance > 0
        ? Math.max(0, Math.round(Number(stop.distanceAlongM) - progress * distance))
        : distance > 0
          ? Math.round(aheadFraction * distance)
          : null;
      const type = String(stop.stopType || 'stop');
      const title = type === 'fuel'
        ? 'Fuel stop ahead'
        : type === 'charging'
          ? 'Charging stop ahead'
          : type === 'rest'
            ? 'Rest stop ahead'
            : 'Recommended stop ahead';
      const placeName = stop.place?.name ? ` at ${stop.place.name}` : '';
      return {
        id: `stop:${stop.id}`,
        kind: type,
        severity: type === 'fuel' || type === 'charging' ? 'medium' : 'low',
        title,
        message: distanceAheadM === null
          ? `Recommended${placeName}.`
          : `${Math.max(0, Math.round(distanceAheadM / 100) * 100)} m ahead${placeName}.`,
        progressFraction: Number(stop.progressFraction),
        distanceAheadM,
        confidence: Number.isFinite(Number(stop.score)) ? Math.min(1, Math.max(0, Number(stop.score) / 100)) : null,
        observationId: null,
        stopId: stop.id
      };
    })
    .sort((a, b) => (a.distanceAheadM ?? Number.MAX_SAFE_INTEGER) - (b.distanceAheadM ?? Number.MAX_SAFE_INTEGER))
    .slice(0, Math.max(0, Number(maxStops) || 0));

  const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
  return [...hazardAlerts, ...stopAlerts]
    .sort((a, b) => {
      if (a.kind === 'hazard' && b.kind !== 'hazard') return -1;
      if (b.kind === 'hazard' && a.kind !== 'hazard') return 1;
      if (a.kind === 'hazard' && b.kind === 'hazard') {
        const severityDiff = (severityWeight[b.severity] ?? 0) - (severityWeight[a.severity] ?? 0);
        if (severityDiff) return severityDiff;
      }
      return (a.distanceAheadM ?? Number.MAX_SAFE_INTEGER) - (b.distanceAheadM ?? Number.MAX_SAFE_INTEGER);
    });
}
