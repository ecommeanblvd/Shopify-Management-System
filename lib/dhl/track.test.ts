import { describe, expect, it } from 'vitest';
import { mapDhlStatus, parseDhlTrack } from './track';

describe('mapDhlStatus', () => {
  it('map statusCode → DeliveryStatus', () => {
    expect(mapDhlStatus('delivered', null)).toBe('delivered');
    expect(mapDhlStatus('failure', null)).toBe('exception');
    expect(mapDhlStatus('transit', null)).toBe('in_transit');
    expect(mapDhlStatus('pre-transit', null)).toBe('in_transit');
    expect(mapDhlStatus('unknown', null)).toBe('unknown');
    expect(mapDhlStatus(null, null)).toBe('unknown');
    expect(mapDhlStatus('weird-code', null)).toBe('unknown');
  });
  it('transit + mô tả "out for delivery" → out_for_delivery', () => {
    expect(mapDhlStatus('transit', 'Out for delivery')).toBe('out_for_delivery');
    expect(mapDhlStatus('transit', 'Shipment is with delivery courier')).toBe('out_for_delivery');
    expect(mapDhlStatus('transit', 'Being delivered')).toBe('out_for_delivery');
    expect(mapDhlStatus('transit', 'Processed at facility')).toBe('in_transit');
  });
});

describe('parseDhlTrack', () => {
  const mk = (statusCode: string, timestamp: string, description = 'x') => ({
    shipments: [{ id: 'JD1', status: { statusCode, status: statusCode, description, timestamp } }],
  });

  it('delivered → status delivered + deliveredAt đúng', () => {
    const r = parseDhlTrack(mk('delivered', '2026-06-24T09:30:00'));
    expect(r.status).toBe('delivered');
    expect(r.statusCode).toBe('delivered');
    expect(r.deliveredAt?.toISOString().slice(0, 10)).toBe('2026-06-24');
  });

  it('transit → in_transit, deliveredAt null', () => {
    const r = parseDhlTrack(mk('transit', '2026-06-22T10:00:00', 'Processed'));
    expect(r.status).toBe('in_transit');
    expect(r.deliveredAt).toBeNull();
  });

  it('transit + out-for-delivery description → out_for_delivery', () => {
    const r = parseDhlTrack(mk('transit', '2026-06-24T07:00:00', 'Out for delivery'));
    expect(r.status).toBe('out_for_delivery');
  });

  it('shipments rỗng / thiếu → unknown, không nổ', () => {
    expect(parseDhlTrack({ shipments: [] }).status).toBe('unknown');
    expect(parseDhlTrack({}).status).toBe('unknown');
    expect(parseDhlTrack(null).status).toBe('unknown');
  });

  it('deliveredAt bỏ qua timestamp rác', () => {
    const r = parseDhlTrack(mk('delivered', 'not-a-date'));
    expect(r.status).toBe('delivered');
    expect(r.deliveredAt).toBeNull();
  });
});
