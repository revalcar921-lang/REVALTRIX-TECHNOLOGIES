import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceKm, validCoordinate } from './appointment-discovery.utils.ts';

test('calculates branch distance from real coordinates', () => {
  const distance = distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
  assert.ok(distance > 111 && distance < 112);
});

test('does not treat missing or malformed coordinates as locations', () => {
  assert.equal(validCoordinate(null), null);
  assert.equal(validCoordinate(''), null);
  assert.equal(validCoordinate('missing'), null);
  assert.equal(validCoordinate('-1.286389'), -1.286389);
});