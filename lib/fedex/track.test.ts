import { describe, it, expect } from 'vitest';
import { mapFedexStatus, parseFedexTrack } from './track';

describe('mapFedexStatus', () => {
  it('DL → delivered', () => expect(mapFedexStatus('DL')).toBe('delivered'));
  it('OD → out_for_delivery', () => expect(mapFedexStatus('OD')).toBe('out_for_delivery'));
  it('IT/AR/DP → in_transit', () => {
    expect(mapFedexStatus('IT')).toBe('in_transit');
    expect(mapFedexStatus('AR')).toBe('in_transit');
    expect(mapFedexStatus('DP')).toBe('in_transit');
  });
  it('DE/SE/CA → exception', () => {
    expect(mapFedexStatus('DE')).toBe('exception');
    expect(mapFedexStatus('CA')).toBe('exception');
  });
  it('code lạ / rỗng → unknown', () => {
    expect(mapFedexStatus('ZZ')).toBe('unknown');
    expect(mapFedexStatus(null)).toBe('unknown');
  });
});

describe('parseFedexTrack', () => {
  const raw = {
    output: { completeTrackResults: [{ trackingNumber: '123', trackResults: [{
      latestStatusDetail: { code: 'DL', statusByLocale: 'Delivered', description: 'Delivered' },
      dateAndTimes: [{ type: 'ACTUAL_DELIVERY', dateTime: '2026-06-20T14:00:00-07:00' }],
    }] }] },
  };
  it('delivered → status + deliveredAt', () => {
    const r = parseFedexTrack(raw);
    expect(r.statusCode).toBe('DL');
    expect(r.status).toBe('delivered');
    expect(r.description).toBe('Delivered');
    expect(r.deliveredAt?.toISOString()).toBe('2026-06-20T21:00:00.000Z');
  });
  it('in transit (không có delivery date) → deliveredAt null', () => {
    const r = parseFedexTrack({ output: { completeTrackResults: [{ trackResults: [{ latestStatusDetail: { code: 'IT', statusByLocale: 'In transit' } }] }] } });
    expect(r.status).toBe('in_transit');
    expect(r.deliveredAt).toBeNull();
  });
  it('rỗng / thiếu field → unknown, null', () => {
    expect(parseFedexTrack({})).toEqual({ statusCode: null, status: 'unknown', description: null, deliveredAt: null });
  });
});
