import { describe, it, expect } from 'vitest';
import { isReconcileCacheStale, type CacheEntryMeta } from './reconcile-cache';

const TTL = 15 * 60 * 1000;
const entry = (at: number, configVersion: number): CacheEntryMeta => ({ at, configVersion });

describe('isReconcileCacheStale', () => {
  it('không có cache → stale', () => {
    expect(isReconcileCacheStale(null, 100, 1_000, TTL)).toBe(true);
  });
  it('config đổi (version khác) → stale, kể cả còn trong TTL', () => {
    // cache lúc 1000 với configVersion 100; config giờ là 200 (đổi) → phải tính lại
    expect(isReconcileCacheStale(entry(1_000, 100), 200, 1_000 + 60_000, TTL)).toBe(true);
  });
  it('hết TTL → stale', () => {
    expect(isReconcileCacheStale(entry(1_000, 100), 100, 1_000 + TTL, TTL)).toBe(true);
  });
  it('cùng version + còn TTL → KHÔNG stale', () => {
    expect(isReconcileCacheStale(entry(1_000, 100), 100, 1_000 + 60_000, TTL)).toBe(false);
  });
});
