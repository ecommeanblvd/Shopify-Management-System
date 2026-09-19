import { describe, it, expect } from 'vitest';
import { mapTrangThai } from './map-trang-thai';
import { LUA_CHON_CATEGORY, LUA_CHON_STATUS } from './cot';

describe('mapTrangThai', () => {
  it('đủ 6 trạng thái có nghĩa (spec §5.1)', () => {
    expect(mapTrangThai('label_created')).toEqual({ category: 'Shipment Created', status: 'Ready for Carrier' });
    expect(mapTrangThai('in_transit')).toEqual({ category: 'In Transit', status: 'On Delivery' });
    expect(mapTrangThai('out_for_delivery')).toEqual({ category: 'In Transit', status: 'On Delivery' });
    expect(mapTrangThai('delivered')).toEqual({ category: 'Delivered', status: 'Delivery Completed' });
    expect(mapTrangThai('exception')).toEqual({ category: 'Shipping Exceptions', status: 'Delayed' });
    expect(mapTrangThai('returning')).toEqual({ category: 'Shipping Failed', status: 'Return-Processing' });
  });
  it('unknown / null / lạ → null (không ghi)', () => {
    expect(mapTrangThai('unknown')).toBeNull();
    expect(mapTrangThai(null)).toBeNull();
    expect(mapTrangThai('gì đó')).toBeNull();
  });
  it('mọi chuỗi ra đều nằm trong danh sách lựa chọn Lark — giá trị lạ sẽ đẻ lựa chọn mới', () => {
    for (const s of ['label_created', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returning']) {
      const m = mapTrangThai(s)!;
      expect(LUA_CHON_CATEGORY).toContain(m.category);
      expect(LUA_CHON_STATUS).toContain(m.status);
    }
  });
});
