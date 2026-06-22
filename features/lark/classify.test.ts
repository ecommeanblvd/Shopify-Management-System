import { describe, it, expect } from 'vitest';
import { classifyPackRows } from './classify';
import type { PackRow } from './parse-pack-row';

const mk = (o: Partial<PackRow>): PackRow => ({
  orderNumber: '', logUniqueCode: null, weightKg: null, dims: null,
  trackingNumber: null, carrierKey: null, labelDate: null, warnings: [], ...o,
});
const emptyMaps = () => ({ shipmentByLogCode: new Map(), shipmentByTracking: new Map(), orderIdByNumber: new Map() });

describe('classifyPackRows', () => {
  it('khớp logUniqueCode → update', () => {
    const maps = emptyMaps(); maps.shipmentByLogCode.set('PK-1', 'ship-1');
    const r = classifyPackRows([mk({ logUniqueCode: 'PK-1', orderNumber: '#MBLVD1' })], maps);
    expect(r.update).toEqual([{ row: expect.objectContaining({ logUniqueCode: 'PK-1' }), shipmentId: 'ship-1' }]);
    expect(r.create).toHaveLength(0);
  });
  it('khớp tracking (không có logCode) → update', () => {
    const maps = emptyMaps(); maps.shipmentByTracking.set('TRK9', 'ship-9');
    const r = classifyPackRows([mk({ trackingNumber: 'TRK9', orderNumber: '#MBLVD1' })], maps);
    expect(r.update[0].shipmentId).toBe('ship-9');
  });
  it('chưa có shipment + order resolve được → create', () => {
    const maps = emptyMaps(); maps.orderIdByNumber.set('MBLVD29149', 'order-1');
    const r = classifyPackRows([mk({ orderNumber: '#MBLVD29149', logUniqueCode: 'PK-new' })], maps);
    expect(r.create).toEqual([{ row: expect.objectContaining({ orderNumber: '#MBLVD29149' }), orderId: 'order-1' }]);
  });
  it('store connected nhưng order không resolve → unmatched', () => {
    const r = classifyPackRows([mk({ orderNumber: '#MIRER163', logUniqueCode: 'PK-x' })], emptyMaps());
    expect(r.unmatched).toEqual([{ orderNumber: '#MIRER163', reason: expect.any(String) }]);
  });
  it('store disconnected (MCN) → skipped', () => {
    const r = classifyPackRows([mk({ orderNumber: '#MCN26', logUniqueCode: 'PK-y' })], emptyMaps());
    expect(r.skipped).toHaveLength(1);
    expect(r.create).toHaveLength(0); expect(r.unmatched).toHaveLength(0);
  });
  it('no_prefix / DISCN → skipped', () => {
    const r = classifyPackRows([mk({ orderNumber: 'DISCN5' }), mk({ orderNumber: 'ZZZ9' })], emptyMaps());
    expect(r.skipped).toHaveLength(2);
  });
  it('2 row trùng logUniqueCode (cùng batch, chưa có shipment) → chỉ tạo 1, dòng sau skip', () => {
    const maps = emptyMaps(); maps.orderIdByNumber.set('MBLVD1', 'order-1');
    const r = classifyPackRows([
      mk({ orderNumber: '#MBLVD1', logUniqueCode: 'PK-dup', trackingNumber: null }),
      mk({ orderNumber: '#MBLVD1', logUniqueCode: 'PK-dup', trackingNumber: null }),
    ], maps);
    expect(r.create).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].reason).toContain('trùng logUniqueCode');
  });
  it('idempotent: row đã update không tạo lại', () => {
    const maps = emptyMaps(); maps.shipmentByLogCode.set('PK-1', 'ship-1'); maps.orderIdByNumber.set('MBLVD1', 'order-1');
    const r = classifyPackRows([mk({ logUniqueCode: 'PK-1', orderNumber: '#MBLVD1' })], maps);
    expect(r.update).toHaveLength(1); expect(r.create).toHaveLength(0);
  });
});
