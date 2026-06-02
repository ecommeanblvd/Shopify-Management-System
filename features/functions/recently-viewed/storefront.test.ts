import { describe, expect, test } from 'vitest';
import { assertIdentity } from './storefront';

describe('assertIdentity (recently-viewed)', () => {
  test('accepts a device-only identity', () => {
    expect(() => assertIdentity({
      deviceId: '00000000-0000-4000-8000-000000000000',
    })).not.toThrow();
  });

  test('accepts an identity with email upgrade', () => {
    expect(() => assertIdentity({
      deviceId: '00000000-0000-4000-8000-000000000000',
      email: 'jane@example.com',
    })).not.toThrow();
  });

  test('rejects missing deviceId — Recently Viewed cannot exist without one', () => {
    expect(() => assertIdentity({ deviceId: '' })).toThrow(/deviceId/);
  });

  test('rejects too-short deviceId', () => {
    expect(() => assertIdentity({ deviceId: 'short' })).toThrow(/Invalid deviceId/);
  });

  test('rejects too-long deviceId', () => {
    expect(() => assertIdentity({ deviceId: 'x'.repeat(65) })).toThrow(/Invalid deviceId/);
  });

  test('rejects malformed email when provided', () => {
    expect(() => assertIdentity({
      deviceId: '00000000-0000-4000-8000-000000000000',
      email: 'not-an-email',
    })).toThrow(/Invalid email/);
  });
});
