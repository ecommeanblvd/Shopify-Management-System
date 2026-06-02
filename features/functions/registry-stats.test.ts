import { describe, expect, test } from 'vitest';
import { rollup, type FunctionActivity } from './registry-stats';

function mk(entries: Array<Partial<FunctionActivity> & { key: string }>): Map<string, FunctionActivity> {
  return new Map(entries.map((e) => [e.key, {
    activeStoreCount: e.activeStoreCount ?? 0,
    last7DaysEvents: e.last7DaysEvents ?? 0,
    key: e.key,
  }]));
}

describe('rollup', () => {
  test('sums activations and events across functions', () => {
    const r = rollup(mk([
      { key: 'wishlist', activeStoreCount: 3, last7DaysEvents: 120 },
      { key: 'recently-viewed', activeStoreCount: 2, last7DaysEvents: 80 },
      { key: 'gift-registry', activeStoreCount: 1, last7DaysEvents: 5 },
      { key: 'save-for-later', activeStoreCount: 0, last7DaysEvents: 0 },
    ]));
    expect(r.totalActivations).toBe(6);
    expect(r.totalEvents7d).toBe(205);
  });

  test('picks the busiest function by event count', () => {
    const r = rollup(mk([
      { key: 'wishlist', last7DaysEvents: 50 },
      { key: 'recently-viewed', last7DaysEvents: 200 },
      { key: 'save-for-later', last7DaysEvents: 10 },
    ]));
    expect(r.busiestFunctionKey).toBe('recently-viewed');
  });

  test('returns null busiest when every function is idle', () => {
    const r = rollup(mk([
      { key: 'wishlist' },
      { key: 'recently-viewed' },
    ]));
    expect(r.busiestFunctionKey).toBeNull();
    expect(r.totalEvents7d).toBe(0);
  });

  test('handles an empty input map', () => {
    const r = rollup(new Map());
    expect(r).toEqual({
      totalActivations: 0,
      totalEvents7d: 0,
      busiestFunctionKey: null,
    });
  });

  test('breaks ties by keeping the first one encountered', () => {
    const r = rollup(mk([
      { key: 'wishlist', last7DaysEvents: 100 },
      { key: 'recently-viewed', last7DaysEvents: 100 },
    ]));
    // First key with the max wins because `>` not `>=`.
    expect(r.busiestFunctionKey).toBe('wishlist');
  });
});
