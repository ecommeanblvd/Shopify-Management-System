import { describe, it, expect } from 'vitest';
import { filterShipHoOrders } from './filter-orders';

const base = { id: '1', code: '26-INSLG-SV-0001', partnerBrandSlug: 'kalisa', brandName: 'Kalisa',
  country: 'US', weightKg: '2', chargeableWeightKg: null, carrierKey: null, carrierCostVnd: null, actualCarrierCostVnd: null,
  actualWeightKg: null, chargedVnd: null, actualChargedVnd: null, marginVnd: null,
  deliveryStatus: null, reconcileStatus: null,
  status: 'draft', source: 'mmp', createdAt: new Date(0),
  customerRef: 'KLS-9001', trackingNumber: '7712345', recipientName: 'Jaque' } as const;

describe('filterShipHoOrders', () => {
  const rows = [
    { ...base, id: 'a', code: '26-INSLG-SV-0001', customerRef: 'KLS-9001', trackingNumber: '7712345', recipientName: 'Jaque', brandName: 'Kalisa', source: 'mmp' },
    { ...base, id: 'b', code: '#KLS1983', customerRef: null, trackingNumber: '9998888', recipientName: 'Bob', brandName: 'Kalisa', source: 'internal' },
  ];
  it('q khớp code hệ thống', () => {
    expect(filterShipHoOrders(rows, { q: 'INSLG-SV-0001' }).map((r) => r.id)).toEqual(['a']);
  });
  it('q khớp mã đơn gốc (customerRef)', () => {
    expect(filterShipHoOrders(rows, { q: 'kls-9001' }).map((r) => r.id)).toEqual(['a']); // case-insensitive
  });
  it('q khớp tracking', () => {
    expect(filterShipHoOrders(rows, { q: '9998888' }).map((r) => r.id)).toEqual(['b']);
  });
  it('q khớp tên brand / người nhận', () => {
    expect(filterShipHoOrders(rows, { q: 'bob' }).map((r) => r.id)).toEqual(['b']);
  });
  it('source=mmp lọc riêng, kết hợp q', () => {
    expect(filterShipHoOrders(rows, { source: 'mmp' }).map((r) => r.id)).toEqual(['a']);
  });
  it('q rỗng/space → không lọc', () => {
    expect(filterShipHoOrders(rows, { q: '  ' }).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
