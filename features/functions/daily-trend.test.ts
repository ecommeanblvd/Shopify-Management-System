import { describe, expect, test, vi } from 'vitest';

vi.mock('@/db/client', () => ({
  db: {
    execute: vi.fn(),
  },
}));

import { db } from '@/db/client';
import { getDailyTrend } from './daily-trend';

describe('getDailyTrend', () => {
  test('maps DB rows to typed buckets and coerces count to number', async () => {
    (db.execute as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [
        { day: '2026-05-27', n: '0' },
        { day: '2026-05-28', n: '12' },
        { day: '2026-05-29', n: '5' },
      ],
    });
    const result = await getDailyTrend('recently_viewed', 'store-1', 3);
    expect(result).toEqual([
      { day: '2026-05-27', count: 0 },
      { day: '2026-05-28', count: 12 },
      { day: '2026-05-29', count: 5 },
    ]);
  });

  test('returns empty array when DB yields no rows', async () => {
    (db.execute as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [],
    });
    const result = await getDailyTrend('save_for_later', 'store-1');
    expect(result).toEqual([]);
  });
});
