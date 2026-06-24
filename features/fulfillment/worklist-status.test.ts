import { describe, it, expect } from 'vitest';
import { summarizeAddr, summarizeBrand, summarizeKcs, summarizeDelivery } from './worklist-status';

describe('summarizeAddr', () => {
  it('chưa verify', () => expect(summarizeAddr({ addrDeliverable: null, addrVerifiedAt: null }).tone).toBe('muted'));
  it('không giao được', () => expect(summarizeAddr({ addrDeliverable: false, addrVerifiedAt: new Date() }).tone).toBe('bad'));
  it('giao được', () => expect(summarizeAddr({ addrDeliverable: true, addrVerifiedAt: new Date() }).tone).toBe('ok'));
});
describe('summarizeBrand', () => {
  it('total 0 → không cần', () => expect(summarizeBrand({ total: 0, awaiting: 0, confirmed: 0, delivered: 0, minExpected: null })).toEqual({ label: 'Không cần', tone: 'muted' }));
  it('all delivered → đã giao', () => expect(summarizeBrand({ total: 2, awaiting: 0, confirmed: 0, delivered: 2, minExpected: null }).tone).toBe('ok'));
  it('awaiting → chờ confirm', () => expect(summarizeBrand({ total: 2, awaiting: 1, confirmed: 1, delivered: 0, minExpected: '2026-06-25' }).tone).toBe('warn'));
  it('confirmed → Confirm + ngày dd/MM', () => expect(summarizeBrand({ total: 1, awaiting: 0, confirmed: 1, delivered: 0, minExpected: '2026-06-25' })).toEqual({ label: 'Confirm · 25/06', tone: 'info' }));
});
describe('summarizeKcs', () => {
  it('fail', () => expect(summarizeKcs({ pending: 0, pass: 1, fail: 1 }).tone).toBe('bad'));
  it('pending', () => expect(summarizeKcs({ pending: 1, pass: 0, fail: 0 }).tone).toBe('warn'));
  it('pass', () => expect(summarizeKcs({ pending: 0, pass: 2, fail: 0 }).tone).toBe('ok'));
  it('none → —', () => expect(summarizeKcs({ pending: 0, pass: 0, fail: 0 })).toEqual({ label: '—', tone: 'muted' }));
});
describe('summarizeDelivery', () => {
  it('chưa pack', () => expect(summarizeDelivery({ packs: 0, withTracking: 0, delivered: 0, exception: 0, inTransit: 0 }).label).toBe('Chưa'));
  it('sự cố', () => expect(summarizeDelivery({ packs: 1, withTracking: 1, delivered: 0, exception: 1, inTransit: 0 }).tone).toBe('bad'));
  it('đã giao', () => expect(summarizeDelivery({ packs: 2, withTracking: 2, delivered: 2, exception: 0, inTransit: 0 }).tone).toBe('ok'));
  it('đang chuyển', () => expect(summarizeDelivery({ packs: 1, withTracking: 1, delivered: 0, exception: 0, inTransit: 1 }).tone).toBe('info'));
});
