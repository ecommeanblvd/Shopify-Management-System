import { describe, it, expect } from 'vitest';
import { mapOrderToBackfill } from './backfill';

describe('mapOrderToBackfill', () => {
  it('map field cơ bản; bỏ field null; số tiền → integer; thời gian → ISO', () => {
    const o = {
      mmpRef: 'MMP-1', code: 'SH1000', status: 'shipped',
      trackingNumber: 'TN1', deliveryStatus: 'in_transit',
      deliveredAt: new Date('2026-07-04T00:00:00.000Z'), chargedVnd: '189540',
    };
    expect(mapOrderToBackfill(o)).toEqual({
      mmpRef: 'MMP-1', code: 'SH1000', status: 'shipped',
      trackingNumber: 'TN1', deliveryStatus: 'in_transit',
      deliveredAt: '2026-07-04T00:00:00.000Z', chargedVnd: 189540,
    });
  });
  it('field null/undefined bị bỏ khỏi output', () => {
    const o = { mmpRef: 'MMP-2', code: 'SH1001', status: 'draft', trackingNumber: null, deliveryStatus: null, deliveredAt: null, chargedVnd: null };
    expect(mapOrderToBackfill(o)).toEqual({ mmpRef: 'MMP-2', code: 'SH1001', status: 'draft' });
  });
});
