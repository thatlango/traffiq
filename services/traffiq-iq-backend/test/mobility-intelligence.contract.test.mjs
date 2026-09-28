import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateObservationConfidence,
  categorizePlace,
  defaultExpiryForType,
  estimateVehicleRangeKm,
  h3Indexes,
  observationStatus,
  scoreStopCandidate
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
