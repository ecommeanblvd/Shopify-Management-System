import { describe, expect, test, vi } from 'vitest';

vi.mock('@/db/client', () => ({ db: {}, schema: {} }));

// The token-shape gate in getWishlistByShareToken runs BEFORE any DB
// call, so it's safe to import the real function and probe its
// validation contract without a live database.
import { getWishlistByShareToken } from './storefront';

describe('getWishlistByShareToken', () => {
  test('rejects an empty token without touching the DB', async () => {
    await expect(getWishlistByShareToken('')).resolves.toBeNull();
  });

  test('rejects a missing prefix', async () => {
    await expect(getWishlistByShareToken('abc123def456')).resolves.toBeNull();
  });

  test('rejects too-short suffix', async () => {
    await expect(getWishlistByShareToken('wl_short')).resolves.toBeNull();
  });

  test('rejects non-alphanumeric chars in suffix', async () => {
    await expect(getWishlistByShareToken('wl_abc123!def456ghi78')).resolves.toBeNull();
    await expect(getWishlistByShareToken('wl_abc 123 def 456 gh')).resolves.toBeNull();
  });

  test('rejects SQL-injection-shaped strings', async () => {
    await expect(getWishlistByShareToken("wl_'; DROP TABLE--")).resolves.toBeNull();
  });
});
