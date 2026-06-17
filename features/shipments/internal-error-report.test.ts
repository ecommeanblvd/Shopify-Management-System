import { describe, it, expect } from 'vitest';
import { summariseInternalErrors, type InternalErrorRow } from './internal-error-report';

const row = (o: Partial<InternalErrorRow>): InternalErrorRow => ({
  shipmentId: 's', orderNumber: '#1', carrierKey: 'dhl', deltaVnd: -100000, note: 'sai cân', ...o,
});

describe('summariseInternalErrors', () => {
  it('gom theo carrier: count + tổng Δ', () => {
    const g = summariseInternalErrors([
      row({ carrierKey: 'dhl', deltaVnd: -100000 }),
      row({ carrierKey: 'dhl', deltaVnd: -50000 }),
      row({ carrierKey: 'fedex', deltaVnd: -200000 }),
    ]);
    const dhl = g.find((x) => x.carrierKey === 'dhl')!;
    const fedex = g.find((x) => x.carrierKey === 'fedex')!;
    expect(dhl).toMatchObject({ count: 2, sumDeltaVnd: -150000 });
    expect(fedex).toMatchObject({ count: 1, sumDeltaVnd: -200000 });
  });
  it('rỗng → []', () => { expect(summariseInternalErrors([])).toEqual([]); });
});
