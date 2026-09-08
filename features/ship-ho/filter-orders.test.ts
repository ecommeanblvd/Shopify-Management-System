import { describe, it, expect } from 'vitest';
import { filterShipHoOrders, locTheoDoiSoat, locTheoBrand, docMucDoiSoat, NHAN_DOI_SOAT } from './filter-orders';

const base = { id: '1', code: '26-INSLG-SV-0001', partnerBrandSlug: 'kalisa', brandName: 'Kalisa',
  country: 'US', weightKg: '2', chargeableWeightKg: null, carrierKey: null, carrierCostVnd: null, actualCarrierCostVnd: null,
  actualWeightKg: null, chargedVnd: null, actualChargedVnd: null, marginVnd: null,
  deliveryStatus: null, reconcileStatus: null, reconcileDecision: null,
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

describe('bộ lọc brand + trạng thái đối soát (cho Đức đối soát)', () => {
  const rows = [
    { ...base, id: 'k1', partnerBrandSlug: 'kalisa', brandName: 'Kalisa', trackingNumber: null, reconcileStatus: null, reconcileDecision: null },
    { ...base, id: 'k2', partnerBrandSlug: 'kalisa', brandName: 'Kalisa', trackingNumber: '1', reconcileStatus: null, reconcileDecision: null },
    { ...base, id: 'k3', partnerBrandSlug: 'kalisa', brandName: 'Kalisa', trackingNumber: '2', reconcileStatus: 'reconciled', reconcileDecision: null },
    { ...base, id: 't1', partnerBrandSlug: 'tinh', brandName: 'TINH', trackingNumber: '3', reconcileStatus: 'reconciled', reconcileDecision: 'pending_review' },
    { ...base, id: 't2', partnerBrandSlug: 'tinh', brandName: 'TINH', trackingNumber: '4', reconcileStatus: 'reconciled', reconcileDecision: 'claiming' },
    { ...base, id: 't3', partnerBrandSlug: 'tinh', brandName: 'TINH', trackingNumber: '5', reconcileStatus: 'reconciled', reconcileDecision: 'accepted' },
  ];
  it('brand=kalisa chỉ giữ đơn kalisa; rỗng → giữ hết', () => {
    expect(locTheoBrand(rows, 'kalisa').map((r) => r.id)).toEqual(['k1', 'k2', 'k3']);
    expect(locTheoBrand(rows, '').length).toBe(6);
    expect(locTheoBrand(rows, undefined).length).toBe(6);
  });
  it('doi_soat theo đúng 5 mức của cột Đối soát', () => {
    expect(locTheoDoiSoat(rows, 'none').map((r) => r.id)).toEqual(['k1']);
    expect(locTheoDoiSoat(rows, 'waiting').map((r) => r.id)).toEqual(['k2']);
    expect(locTheoDoiSoat(rows, 'done').map((r) => r.id)).toEqual(['k3', 't3']); // khớp tự động + đã duyệt
    expect(locTheoDoiSoat(rows, 'review').map((r) => r.id)).toEqual(['t1']);
    expect(locTheoDoiSoat(rows, 'claiming').map((r) => r.id)).toEqual(['t2']);
    expect(locTheoDoiSoat(rows, undefined).length).toBe(6);
  });
  it('kết hợp brand + doi_soat + q trong filterShipHoOrders', () => {
    expect(filterShipHoOrders(rows, { brand: 'tinh', doiSoat: 'done' }).map((r) => r.id)).toEqual(['t3']);
    expect(filterShipHoOrders(rows, { brand: 'tinh', doiSoat: 'done', q: 'kalisa' })).toEqual([]);
  });
  it('docMucDoiSoat: giá trị lạ → undefined', () => {
    expect(docMucDoiSoat('review')).toBe('review');
    expect(docMucDoiSoat('xyz')).toBeUndefined();
    expect(docMucDoiSoat(undefined)).toBeUndefined();
    expect(Object.keys(NHAN_DOI_SOAT)).toHaveLength(5);
  });
});
