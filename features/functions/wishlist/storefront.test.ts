import { describe, expect, test } from 'vitest';
import { assertIdentity } from './storefront';

describe('assertIdentity', () => {
  test('accepts a valid email-only identity', () => {
    expect(() => assertIdentity({ email: 'jane@example.com' })).not.toThrow();
  });

  test('accepts a valid device-only identity', () => {
    expect(() => assertIdentity({ deviceId: '00000000-0000-4000-8000-000000000000' })).not.toThrow();
  });

  test('rejects empty identity', () => {
    expect(() => assertIdentity({})).toThrow(/Identity required/);
  });

  test('rejects malformed email', () => {
    expect(() => assertIdentity({ email: 'not-an-email' })).toThrow(/Invalid email/);
  });

  test('rejects too-short device id', () => {
    expect(() => assertIdentity({ deviceId: 'short' })).toThrow(/Invalid deviceId/);
  });

  test('rejects too-long device id', () => {
    expect(() => assertIdentity({ deviceId: 'x'.repeat(65) })).toThrow(/Invalid deviceId/);
  });

  test('accepts identity with both email and deviceId', () => {
    expect(() => assertIdentity({
      email: 'jane@example.com',
      deviceId: '00000000-0000-4000-8000-000000000000',
    })).not.toThrow();
  });
});
