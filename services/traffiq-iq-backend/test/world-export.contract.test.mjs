import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTraffiqWorldBatch } from '../src/world-export.js';

test('TraffIQ world export is spatial, evidence-backed and privacy-safe', () => {
  const batch = buildTraffiqWorldBatch([
    {
      id: '8d18438e-15db-444b-af9e-07a54f1d6a0d',
      user_id: 'private-user',
      journey_id: 'private-journey',
      client_id: 'private-client',
      type: 'road_damage',
      severity: 'high',
      status: 'active',
      lat: 2.772,
      lng: 32.299,
      description: 'private free text',
      occurred_at: new Date('2026-09-22T12:00:00.000Z'),
      confirmations: 4,
      disputes: 1,
      metadata: { device: 'private-device', plate: 'private-value' },
      updated_at: new Date('2026-09-22T12:04:00.000Z'),
    },
  ], '2026-09-22T12:05:00.000Z');

  assert.equal(batch.entities.length, 1);
  assert.equal(batch.events.length, 1);
  assert.equal(batch.entities[0].id, 'traffiq:incident:8d18438e-15db-444b-af9e-07a54f1d6a0d');
  assert.deepEqual(batch.entities[0].location, { latitude: 2.772, longitude: 32.299 });
  assert.equal(batch.entities[0].confidence.level, 'observed');
  assert.equal(batch.entities[0].properties.type, 'road_damage');
  assert.equal(batch.entities[0].properties.confirmations, 4);

  const serialized = JSON.stringify(batch);
  for (const forbidden of [
    'private-user',
    'private-journey',
    'private-client',
    'private free text',
    'private-device',
    'private-value',
    'user_id',
    'journey_id',
    'client_id',
    'description',
    'metadata',
  ]) {
    assert.equal(serialized.includes(forbidden), false, 'privacy boundary leaked: ' + forbidden);
  }
});
