import { describe, it, expect } from 'vitest';
import { hashPayload, shouldInsertSnapshot } from './snapshots';

describe('hashPayload', () => {
  it('produces the same hash regardless of key order', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });
  it('produces different hashes for different data', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});

describe('shouldInsertSnapshot', () => {
  it('inserts when there is no previous snapshot', () => {
    expect(shouldInsertSnapshot(null, hashPayload({ a: 1 }))).toBe(true);
  });
  it('skips when the hash matches the latest snapshot', () => {
    const h = hashPayload({ a: 1 });
    expect(shouldInsertSnapshot(h, h)).toBe(false);
  });
  it('inserts when the hash differs from the latest snapshot', () => {
    expect(shouldInsertSnapshot(hashPayload({ a: 1 }), hashPayload({ a: 2 }))).toBe(true);
  });
});
