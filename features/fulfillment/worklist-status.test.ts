import { describe, it, expect } from 'vitest';
import { summarizeAddr, summarizeKcs, summarizeDelivery, formatTrackingStatus, carrierTrackingUrl } from './worklist-status';

describe('summarizeAddr', () => {
  it('chưa verify', () => expect(summarizeAddr({ addrDeliverable: null, addrVerifiedAt: null }).tone).toBe('muted'));
  it('không giao được', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date() }).tone).toBe('bad'));
  it('giao được', () => expect(summarizeAddr({ addrDeliverable: true, addrVerifiedAt: new Date() }).tone).toBe('ok'));
  it('census_verified → ok', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date(), addrConfidence: 'census_verified' }).tone).toBe('ok'));
  it('zip_only → warn', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date(), addrConfidence: 'zip_only' }).tone).toBe('warn'));
  it('undeliverable → bad', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date(), addrConfidence: 'undeliverable' }).tone).toBe('bad'));
  it('confidence null → fallback boolean (ok)', () => expect(summarizeAddr({ addrDeliverable: true, addrVerifiedAt: new Date(), addrConfidence: null }).tone).toBe('ok'));
});
describe('summarizeKcs', () => {
  it('fail', () => expect(summarizeKcs({ pending: 0, pass: 1, fail: 1 }).tone).toBe('bad'));
  it('pending', () => expect(summarizeKcs({ pending: 1, pass: 0, fail: 0 }).tone).toBe('warn'));
  it('pass', () => expect(summarizeKcs({ pending: 0, pass: 2, fail: 0 }).tone).toBe('ok'));
  it('none → —', () => expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 })).toEqual({ label: '—', tone: 'muted' }));
});

describe('summarizeKcs + larkQc', () => {
  it('hệ thống có data → ưu tiên hệ thống (bỏ qua larkQc)', () => {
    expect(summarizeKcs({ pending: 0, pass: 2, fail: 0 }, 'fail').tone).toBe('ok');
  });
  it('hệ thống rỗng → fallback larkQc', () => {
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, 'fail').tone).toBe('bad');
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, 'pending').tone).toBe('warn');
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, 'pass').tone).toBe('ok');
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, 'extra')).toEqual({ label: 'Gửi dư', tone: 'info' });
  });
  it('cả hai rỗng → muted', () => {
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }, null).tone).toBe('muted');
    expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 }).tone).toBe('muted');
  });
});

describe('formatTrackingStatus', () => {
  it('map trạng thái API', () => {
    expect(formatTrackingStatus('delivered')).toEqual({ label: 'Đã giao', tone: 'ok' });
    expect(formatTrackingStatus('in_transit').tone).toBe('info');
    expect(formatTrackingStatus('out_for_delivery').tone).toBe('info');
    expect(formatTrackingStatus('exception')).toEqual({ label: 'Sự cố', tone: 'bad' });
    expect(formatTrackingStatus(null)).toEqual({ label: 'Chưa cập nhật', tone: 'muted' });
  });
});

describe('carrierTrackingUrl', () => {
  it('fedex/dhl/khác', () => {
    expect(carrierTrackingUrl('fedex', '7795')).toContain('fedex.com/fedextrack/?trknbr=7795');
    expect(carrierTrackingUrl('dhl', '12345')).toContain('tracking-id=12345');
    expect(carrierTrackingUrl(null, 'x')).toBe('#');
  });
});
describe('summarizeDelivery', () => {
  it('chưa pack', () => expect(summarizeDelivery({ packs: 0, withTracking: 0, delivered: 0, exception: 0, inTransit: 0 }).label).toBe('Chưa'));
  it('sự cố', () => expect(summarizeDelivery({ packs: 1, withTracking: 1, delivered: 0, exception: 1, inTransit: 0 }).tone).toBe('bad'));
  it('đã giao', () => expect(summarizeDelivery({ packs: 2, withTracking: 2, delivered: 2, exception: 0, inTransit: 0 }).tone).toBe('ok'));
  it('đang chuyển', () => expect(summarizeDelivery({ packs: 1, withTracking: 1, delivered: 0, exception: 0, inTransit: 1 }).tone).toBe('info'));
});
