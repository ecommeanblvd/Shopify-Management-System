import { describe, expect, it } from 'vitest';
import { toCandidates } from './allocate';

describe('toCandidates', () => {
  it('gộp dòng tồn thành candidates available = onHand - reserved', () => {
    expect(toCandidates([
      { warehouseCode: 'HN', qtyOnHand: 5, qtyReserved: 2 },
      { warehouseCode: 'SG', qtyOnHand: 1, qtyReserved: 1 },
    ])).toEqual([{ code: 'HN', available: 3 }, { code: 'SG', available: 0 }]);
  });
});
