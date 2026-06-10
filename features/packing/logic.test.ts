import { describe, it, expect } from 'vitest';
import { canShipPack, validatePackDims } from './logic';

describe('canShipPack', () => {
  it('blocks when not check-packed', () => {
    const r = canShipPack({ checkPackedAt: null, lineCount: 2 });
    expect(r.ok).toBe(false);
  });
  it('blocks when no lines', () => {
    const r = canShipPack({ checkPackedAt: new Date('2026-01-01'), lineCount: 0 });
    expect(r.ok).toBe(false);
  });
  it('allows when check-packed and has lines', () => {
    expect(canShipPack({ checkPackedAt: new Date('2026-01-01'), lineCount: 1 })).toEqual({ ok: true });
  });
});

describe('validatePackDims', () => {
  it('allows all-empty (dims optional)', () => {
    expect(validatePackDims({}).ok).toBe(true);
  });
  it('allows positive values', () => {
    expect(validatePackDims({ lengthCm: 10, widthCm: 5, heightCm: 3, weightKg: 1.2 }).ok).toBe(true);
  });
  it('rejects a non-positive provided value', () => {
    expect(validatePackDims({ weightKg: 0 }).ok).toBe(false);
    expect(validatePackDims({ lengthCm: -1 }).ok).toBe(false);
  });
});
