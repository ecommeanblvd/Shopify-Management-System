import { describe, it, expect } from 'vitest';
import { summariseUnmatched, type UnmatchedBilledRow } from './unmatched-billed';

const row = (o: Partial<UnmatchedBilledRow>): UnmatchedBilledRow => ({
  tracking: 't', billNumber: 'B', carrierKey: 'dhl', accountId: 'a', accountName: 'DHL', amountVnd: 1000, billPeriodStart: '2026-05-01', shipHoCode: null, returnOfOrderNumber: null, ...o,
});

describe('summariseUnmatched', () => {
  it('đếm tổng + gom theo carrier (count, Σ)', () => {
    const s = summariseUnmatched([
      row({ tracking: '1', carrierKey: 'dhl', amountVnd: 1000 }),
      row({ tracking: '2', carrierKey: 'dhl', amountVnd: 500 }),
      row({ tracking: '3', carrierKey: 'fedex', amountVnd: 2000 }),
    ]);
    expect(s.total).toBe(3);
    expect(s.byCarrier).toEqual([
      { carrierKey: 'dhl', count: 2, sumVnd: 1500 },
      { carrierKey: 'fedex', count: 1, sumVnd: 2000 },
    ]);
  });
  it('amountVnd null → cộng 0; rỗng → total 0', () => {
    expect(summariseUnmatched([]).total).toBe(0);
    const s = summariseUnmatched([row({ carrierKey: 'dhl', amountVnd: null })]);
    expect(s.byCarrier[0]).toEqual({ carrierKey: 'dhl', count: 1, sumVnd: 0 });
  });
});
