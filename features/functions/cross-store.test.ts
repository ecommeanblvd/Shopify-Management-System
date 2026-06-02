import { describe, expect, test } from 'vitest';
import { rollupCrossStore, type StoreActivityRow } from './cross-store';

function mk(over: Partial<StoreActivityRow> = {}): StoreActivityRow {
  return {
    storeId: 's',
    storeName: 'Store',
    shopDomain: 's.myshopify.com',
    enabled: false,
    totalEvents: 0,
    events7d: 0,
    lastEventAt: null,
    ...over,
  };
}

describe('rollupCrossStore', () => {
  test('counts every row, only enabled in activeStoreCount', () => {
    const rollup = rollupCrossStore([
      mk({ enabled: true, totalEvents: 100, events7d: 30 }),
      mk({ enabled: true, totalEvents: 40,  events7d: 10 }),
      mk({ enabled: false, totalEvents: 5,  events7d: 0  }),
    ]);
    expect(rollup).toEqual({
      storeCount: 3,
      activeStoreCount: 2,
      totalEvents: 145,
      totalEvents7d: 40,
    });
  });

  test('returns zero counts on empty input', () => {
    expect(rollupCrossStore([])).toEqual({
      storeCount: 0,
      activeStoreCount: 0,
      totalEvents: 0,
      totalEvents7d: 0,
    });
  });

  test('ignores last-event timestamps in the count — they exist only for sorting', () => {
    const rollup = rollupCrossStore([
      mk({ totalEvents: 1, lastEventAt: new Date('2026-06-01') }),
      mk({ totalEvents: 1, lastEventAt: null }),
    ]);
    expect(rollup.totalEvents).toBe(2);
  });
});
