import { describe, it, expect } from 'vitest';
import { parseEnv } from './env';

describe('parseEnv', () => {
  const valid = {
    DATABASE_URL: 'postgres://localhost/db',
    ENCRYPTION_KEY_V1: 'a'.repeat(64),
    ENCRYPTION_KEY_CURRENT: 'v1',
    SHOPIFY_API_KEY: 'key',
    SHOPIFY_API_SECRET: 'secret',
    SHOPIFY_SCOPES: 'read_shipping',
    SHOPIFY_APP_URL: 'http://localhost:3000',
    SHOPIFY_API_VERSION: '2025-01',
    BETTER_AUTH_SECRET: 's'.repeat(32),
    BETTER_AUTH_URL: 'http://localhost:3000',
  };

  it('parses a valid environment', () => {
    expect(parseEnv(valid).SHOPIFY_API_VERSION).toBe('2025-01');
  });

  it('throws when a required variable is missing', () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when ENCRYPTION_KEY_CURRENT has no matching key', () => {
    expect(() => parseEnv({ ...valid, ENCRYPTION_KEY_CURRENT: 'v9' })).toThrow();
  });
});
