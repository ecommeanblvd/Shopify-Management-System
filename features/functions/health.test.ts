import { describe, expect, test } from 'vitest';
import { classifyHealth, rollupHealth, type FunctionHealthRow } from './health';

const NOW = new Date('2026-06-02T12:00:00Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe('classifyHealth', () => {
  test('returns "never" when there has never been an event', () => {
    expect(classifyHealth(null, NOW)).toEqual({ status: 'never', daysSilent: null });
  });

  test('returns "healthy" for events within the last 7 days', () => {
    expect(classifyHealth(daysAgo(0), NOW).status).toBe('healthy');
    expect(classifyHealth(daysAgo(3), NOW).status).toBe('healthy');
    expect(classifyHealth(daysAgo(6), NOW).status).toBe('healthy');
  });

  test('returns "quiet" between 7 and 14 days', () => {
    expect(classifyHealth(daysAgo(7), NOW).status).toBe('quiet');
    expect(classifyHealth(daysAgo(10), NOW).status).toBe('quiet');
    expect(classifyHealth(daysAgo(13), NOW).status).toBe('quiet');
  });

  test('returns "silent" at 14 days and beyond', () => {
    expect(classifyHealth(daysAgo(14), NOW).status).toBe('silent');
    expect(classifyHealth(daysAgo(30), NOW).status).toBe('silent');
    expect(classifyHealth(daysAgo(365), NOW).status).toBe('silent');
  });

  test('clamps negative days (clock skew) to zero', () => {
    const future = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);
    expect(classifyHealth(future, NOW)).toEqual({ status: 'healthy', daysSilent: 0 });
  });
});

describe('rollupHealth', () => {
  function mk(status: FunctionHealthRow['status']): FunctionHealthRow {
    return {
      functionKey: 'wishlist',
      storeId: 's', storeName: 'S', shopDomain: 's.myshopify.com',
      lastEventAt: status === 'never' ? null : new Date(),
      status, daysSilent: status === 'never' ? null : 0,
    };
  }

  test('counts each status correctly and flags needsAttention', () => {
    const rollup = rollupHealth([
      mk('healthy'), mk('healthy'),
      mk('quiet'),
      mk('silent'), mk('silent'),
      mk('never'),
    ]);
    expect(rollup).toEqual({
      total: 6,
      healthy: 2,
      quiet: 1,
      silent: 2,
      never: 1,
      needsAttention: 3,
    });
  });

  test('returns zero counts on an empty list', () => {
    expect(rollupHealth([])).toEqual({
      total: 0, healthy: 0, quiet: 0, silent: 0, never: 0, needsAttention: 0,
    });
  });

  test('quiet does NOT count as needsAttention', () => {
    const rollup = rollupHealth([mk('quiet'), mk('quiet'), mk('quiet')]);
    expect(rollup.needsAttention).toBe(0);
  });
});
