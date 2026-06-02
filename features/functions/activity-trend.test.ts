import { describe, expect, test, vi } from 'vitest';

vi.mock('@/db/client', () => ({
  db: { execute: vi.fn() },
}));

import { db } from '@/db/client';
import { getActivityTrend } from './activity-trend';

const execute = db.execute as unknown as ReturnType<typeof vi.fn>;

describe('getActivityTrend', () => {
  test('pivots flat rows into one bucket per day with all 4 functions present', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        { day: '2026-05-27', function_key: 'wishlist',        n: '3' },
        { day: '2026-05-27', function_key: 'recently-viewed', n: '20' },
        { day: '2026-05-27', function_key: 'save-for-later',  n: '0' },
        { day: '2026-05-27', function_key: 'gift-registry',   n: '1' },
        { day: '2026-05-28', function_key: 'wishlist',        n: '5' },
        { day: '2026-05-28', function_key: 'recently-viewed', n: '12' },
        { day: '2026-05-28', function_key: 'save-for-later',  n: '2' },
        { day: '2026-05-28', function_key: 'gift-registry',   n: '0' },
      ],
    });
    const result = await getActivityTrend(2);
    expect(result).toEqual([
      {
        day: '2026-05-27',
        byFunction: { wishlist: 3, 'recently-viewed': 20, 'save-for-later': 0, 'gift-registry': 1 },
      },
      {
        day: '2026-05-28',
        byFunction: { wishlist: 5, 'recently-viewed': 12, 'save-for-later': 2, 'gift-registry': 0 },
      },
    ]);
  });

  test('returns empty array when DB yields no rows', async () => {
    execute.mockResolvedValueOnce({ rows: [] });
    expect(await getActivityTrend()).toEqual([]);
  });

  test('zero-fills missing function keys for a day', async () => {
    // DB returned only wishlist for the day — the pivot should still
    // include the other 3 known keys at zero.
    execute.mockResolvedValueOnce({
      rows: [{ day: '2026-05-27', function_key: 'wishlist', n: '4' }],
    });
    const [bucket] = await getActivityTrend(1);
    expect(bucket.byFunction).toEqual({
      wishlist: 4,
      'recently-viewed': 0,
      'save-for-later': 0,
      'gift-registry': 0,
    });
  });
});
