import { describe, it, expect } from 'vitest';
import { mapTrackingMoreStatus, TRACKINGMORE_COURIER } from './track';

describe('mapTrackingMoreStatus', () => {
  it('delivered → delivered', () => expect(mapTrackingMoreStatus('delivered')).toBe('delivered'));
  it('transit/pickup/inforeceived → in_transit', () => {
    expect(mapTrackingMoreStatus('transit')).toBe('in_transit');
    expect(mapTrackingMoreStatus('pickup')).toBe('in_transit');
    expect(mapTrackingMoreStatus('inforeceived')).toBe('in_transit');
  });
  it('undelivered/exception → exception', () => {
    expect(mapTrackingMoreStatus('undelivered')).toBe('exception');
    expect(mapTrackingMoreStatus('exception')).toBe('exception');
  });
  it('pending/notfound/expired/null → unknown', () => {
    expect(mapTrackingMoreStatus('pending')).toBe('unknown');
    expect(mapTrackingMoreStatus('notfound')).toBe('unknown');
    expect(mapTrackingMoreStatus('expired')).toBe('unknown');
    expect(mapTrackingMoreStatus(null)).toBe('unknown');
  });
  it('case-insensitive', () => expect(mapTrackingMoreStatus('Delivered')).toBe('delivered'));
});

describe('TRACKINGMORE_COURIER', () => {
  it('map đủ các hãng đang dùng trong hệ thống', () => {
    for (const k of ['fedex', 'dhl', 'ups', 'aramex', 'sf-express']) {
      expect(TRACKINGMORE_COURIER[k], k).toBeTruthy();
    }
  });
});
