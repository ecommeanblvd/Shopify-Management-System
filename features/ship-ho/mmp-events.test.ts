import { describe, it, expect } from 'vitest';
import { buildEnvelope } from './mmp-events';

describe('buildEnvelope', () => {
  it('đúng shape { event, mmpRef, code, occurredAt, data }', () => {
    const e = buildEnvelope(
      { id: 'o1', code: 'SH1000', source: 'mmp', mmpRef: 'MMP-1' },
      'shipment.booked', { trackingNumber: 'TN1' }, '2026-07-04T00:00:00.000Z',
    );
    expect(e).toEqual({
      event: 'shipment.booked', mmpRef: 'MMP-1', code: 'SH1000',
      occurredAt: '2026-07-04T00:00:00.000Z', data: { trackingNumber: 'TN1' },
    });
  });
});
