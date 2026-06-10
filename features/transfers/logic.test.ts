import { describe, it, expect } from 'vitest';
import { canTransitionTransfer, nextTransferCode, validateTransfer } from './logic';

describe('canTransitionTransfer', () => {
  it('allows the valid forward + cancel transitions', () => {
    expect(canTransitionTransfer('draft', 'in_transit')).toBe(true);
    expect(canTransitionTransfer('in_transit', 'received')).toBe(true);
    expect(canTransitionTransfer('draft', 'cancelled')).toBe(true);
    expect(canTransitionTransfer('in_transit', 'cancelled')).toBe(true);
  });
  it('rejects invalid transitions', () => {
    expect(canTransitionTransfer('received', 'in_transit')).toBe(false);
    expect(canTransitionTransfer('draft', 'received')).toBe(false);
    expect(canTransitionTransfer('cancelled', 'in_transit')).toBe(false);
    expect(canTransitionTransfer('received', 'cancelled')).toBe(false);
  });
});

describe('nextTransferCode', () => {
  it('joins from/to/seq', () => {
    expect(nextTransferCode('HN', 'SG', 100001)).toBe('HN-SG-100001');
  });
});

describe('validateTransfer', () => {
  const ok = { fromWarehouseId: 'a', toWarehouseId: 'b', lines: [{ sku: 'X', qty: 2 }] };
  it('accepts valid input', () => {
    expect(validateTransfer(ok).ok).toBe(true);
  });
  it('rejects same from/to', () => {
    expect(validateTransfer({ ...ok, toWarehouseId: 'a' }).ok).toBe(false);
  });
  it('rejects empty lines', () => {
    expect(validateTransfer({ ...ok, lines: [] }).ok).toBe(false);
  });
  it('rejects a non-positive qty or blank sku', () => {
    expect(validateTransfer({ ...ok, lines: [{ sku: 'X', qty: 0 }] }).ok).toBe(false);
    expect(validateTransfer({ ...ok, lines: [{ sku: '  ', qty: 1 }] }).ok).toBe(false);
  });
});
