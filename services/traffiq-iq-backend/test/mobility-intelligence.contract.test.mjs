import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouteAlerts,
  calculateObservationConfidence,
  categorizePlace,
  defaultExpiryForType,
  estimateVehicleRangeKm,
  h3Indexes,
  observationStatus,
  scoreStopCandidate,
  shouldReplanJourney
} from '../src/mobility-core.js';

test('H3 indexes are generated at all supported resolutions', () => {
  const h3 = h3Indexes(2.7724, 32.2881);
  assert.match(h3.r7, /^[0-9a-f]+$/);
  assert.match(h3.r8, /^[0-9a-f]+$/);
  assert.match(h3.r9, /^[0-9a-f]+$/);
  assert.notEqual(h3.r7, h3.r8);
});

test('temporary traffic expires much sooner than durable pothole intelligence', () => {
  const observed = new Date('2026-09-28T10:00:00Z');
  const traffic = defaultExpiryForType('traffic', observed);
  const pothole = defaultExpiryForType('pothole', observed);
  assert.ok(traffic > observed);
  assert.ok(pothole.getTime() - observed.getTime() > traffic.getTime() - observed.getTime());
});

test('corroboration raises confidence and disputes reduce it', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  const expires = new Date('2026-09-29T10:00:00Z');
  const baseline = calculateObservationConfidence({
    baseConfidence: 0.25, confirmations: 0, disputes: 0, observedAt: now, expiresAt: expires
  }, now);
  const corroborated = calculateObservationConfidence({
    baseConfidence: 0.25, confirmations: 4, disputes: 0, observedAt: now, expiresAt: expires
  }, now);
  const disputed = calculateObservationConfidence({
    baseConfidence: 0.25, confirmations: 1, disputes: 3, observedAt: now, expiresAt: expires
  }, now);
  assert.ok(corroborated > baseline);
  assert.ok(disputed < baseline);
  assert.equal(observationStatus({ confidence: corroborated, confirmations: 4 }), 'confirmed');
});

test('vehicle range uses tank, fuel level and consumption', () => {
  const range = estimateVehicleRangeKm({
    tankCapacityL: 60,
    currentFuelPct: 50,
    expectedConsumptionLPer100Km: 10
  });
  assert.equal(range, 300);
});

test('journey stop scoring prefers smaller detours near the target', () => {
  const near = scoreStopCandidate({ stopType: 'fuel', progress: 0.55, detourM: 300, targetProgress: 0.55, reliability: 1 });
  const far = scoreStopCandidate({ stopType: 'fuel', progress: 0.20, detourM: 4000, targetProgress: 0.55, reliability: 0.5 });
  assert.ok(near > far);
  assert.equal(categorizePlace('gas_station'), 'fuel');
  assert.equal(categorizePlace('restaurant'), 'rest');
});


test('replanning is backend-gated by corridor distance unless forced', () => {
  assert.equal(shouldReplanJourney({ offRouteDistanceM: 120 }), false);
  assert.equal(shouldReplanJourney({ offRouteDistanceM: 240 }), true);
  assert.equal(shouldReplanJourney({ offRouteDistanceM: 50, force: true }), true);
  assert.equal(shouldReplanJourney({ offRouteDistanceM: 350, thresholdM: 500 }), false);
});


test('route alerts rank urgent hazards and nearby stops ahead of the traveller', () => {
  const alerts = buildRouteAlerts({
    currentProgress: 0.40,
    routeDistanceM: 100000,
    observations: [
      { id: 'hazard-a', type: 'pothole', severity: 'high', confidence: 0.8, progressFraction: 0.45 },
      { id: 'old-hazard', type: 'traffic', severity: 'critical', confidence: 0.9, progressFraction: 0.20 },
      { id: 'far-hazard', type: 'crash', severity: 'critical', confidence: 0.9, progressFraction: 0.85 }
    ],
    stops: [
      { id: 'fuel-a', stopType: 'fuel', status: 'planned', recommended: true, progressFraction: 0.60, place: { name: 'Fuel One' } }
    ]
  });
  assert.equal(alerts[0].id, 'observation:hazard-a');
  assert.equal(alerts[0].distanceAheadM, 5000);
  assert.ok(alerts.some(item => item.id === 'stop:fuel-a'));
  assert.ok(!alerts.some(item => item.id === 'observation:old-hazard'));
  assert.ok(!alerts.some(item => item.id === 'observation:far-hazard'));
});
