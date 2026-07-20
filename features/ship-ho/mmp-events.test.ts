import { describe, it, expect } from 'vitest';
import { buildEnvelope } from './mmp-events';

describe('buildEnvelope', () => {
  it('đúng shape { event, mmpRef, code, occurredAt, data }', () => {
    const e = buildEnvelope(
      { id: 'o1', code: 'SH1000', source: 'mmp', mmpRef: 'MMP-1' },
      'shipment.booked', { trackingNumber: 'TN1' }, '2026-07-04T00:00:00.000Z',
    );
    expect(e).toEqual({
      event: 'shipment.booked', mmpRef: 'MMP-1', code: 'SH1000', origin: 'mmp',
      occurredAt: '2026-07-04T00:00:00.000Z', data: { trackingNumber: 'TN1' },
    });
  });
  it('đơn khởi tạo từ SMS (internal): mmpRef = code, origin = sms', () => {
    const e = buildEnvelope(
      { id: 'o2', code: '26-INSLG-SV-0013', source: 'internal', mmpRef: null },
      'order.received', { chargedVnd: 1_000_000 }, '2026-07-20T00:00:00.000Z',
    );
    expect(e.mmpRef).toBe('26-INSLG-SV-0013');
    expect(e.origin).toBe('sms');
    expect(e.code).toBe('26-INSLG-SV-0013');
  });
});
