import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeKenyanPhoneNumber } from './appointment-payment.utils.ts';

test('normalizes supported Kenyan mobile formats for STK Push', () => {
  assert.equal(normalizeKenyanPhoneNumber('0712 345 678'), '254712345678');
  assert.equal(normalizeKenyanPhoneNumber('+254 (112) 345-678'), '254112345678');
  assert.equal(normalizeKenyanPhoneNumber('254712345678'), '254712345678');
});

test('rejects unsupported, malformed, and non-Kenyan phone numbers', () => {
  for (const phone of ['071234567', '254012345678', '+12025550123', 'abcdefghij']) {
    assert.throws(() => normalizeKenyanPhoneNumber(phone));
  }
});