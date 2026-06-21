import { describe, it, expect } from 'vitest';
import { summariseCarrierErrors, type CarrierErrorRow } from './carrier-error-report';

const row = (over: Partial<CarrierErrorRow>): CarrierErrorRow => ({
  shipmentId: 's', carrierKey: 'fedex', orderName: null, tracking: null,
  shipCountry: null, labelDate: null, kind: 'weight', note: 'x',
  billedVnd: null, deltaVnd: 100, recoveredVnd: null, creditNoteNumber: null,
  approvedByName: null, approvedAt: new Date(0),
  state: 'approved', ...over,
});

describe('summariseCarrierErrors', () => {
  it('rỗng → []', () => expect(summariseCarrierErrors([])).toEqual([]));

  it('gom theo carrier, cộng delta, null→0', () => {
    const g = summariseCarrierErrors([
      row({ carrierKey: 'fedex', deltaVnd: 100, kind: 'weight' }),
      row({ carrierKey: 'fedex', deltaVnd: null, kind: 'zone' }),
      row({ carrierKey: 'dhl', deltaVnd: 50, kind: 'weight' }),
    ]);
    const fedex = g.find((x) => x.carrierKey === 'fedex')!;
    const dhl = g.find((x) => x.carrierKey === 'dhl')!;
    expect(fedex.count).toBe(2);
    expect(fedex.sumDeltaVnd).toBe(100);
    expect(dhl.sumDeltaVnd).toBe(50);
  });

  it('byKind theo thứ tự CARRIER_ERROR_KINDS', () => {
    const g = summariseCarrierErrors([
      row({ carrierKey: 'fedex', kind: 'zone', deltaVnd: 10 }),
      row({ carrierKey: 'fedex', kind: 'weight', deltaVnd: 20 }),
    ]);
    expect(g[0].byKind.map((k) => k.kind)).toEqual(['weight', 'zone']);
    expect(g[0].byKind[0].sumDeltaVnd).toBe(20);
  });

  it('summarise vẫn đúng trên rows approved (caller lọc state)', () => {
    const g = summariseCarrierErrors([
      row({ carrierKey: 'fedex', state: 'approved', deltaVnd: 100, kind: 'weight' }),
      row({ carrierKey: 'fedex', state: 'approved', deltaVnd: null, kind: 'zone' }),
    ]);
    expect(g[0].count).toBe(2);
    expect(g[0].sumDeltaVnd).toBe(100);
  });
});
