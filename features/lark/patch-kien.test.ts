import { describe, it, expect } from 'vitest';
import { patchFrom, giaTriTaoKien } from './patch-kien';
import type { PackRow } from './parse-pack-row';

const mk = (o: Partial<PackRow>): PackRow => ({
  orderNumber: '#MBLVD1', orderNumbers: ['#MBLVD1'], logUniqueCode: 'PK-1', weightKg: null, dims: null, trackingNumber: null,
  carrierKey: null, labelDate: null, base: null, ngayDiDuKien: null, hop: null, hopRecordId: null, skuText: null, pieces: null, warnings: [], ...o,
});

describe('patchFrom', () => {
  it('chỉ ghi trường Lark có giá trị; cân/kích thước thành chuỗi numeric', () => {
    const p = patchFrom(mk({ weightKg: 1.6, dims: { l: 40, w: 30, h: 2 }, hop: 'Box A', skuText: 'X x1', pieces: 2 }));
    expect(p).toMatchObject({ actualWeightKg: '1.6', dimLengthCm: '40', dimWidthCm: '30', dimHeightCm: '2', larkHop: 'Box A', skuText: 'X x1', pieces: 2 });
    expect(p.trackingNumber).toBeUndefined();
    expect(p.updatedAt).toBeInstanceOf(Date);
  });
  it('dòng trống → chỉ có updatedAt và ngày đi dự kiến (đồng bộ hẳn theo Lark, kể cả xoá)', () => {
    expect(Object.keys(patchFrom(mk({})))).toEqual(['updatedAt', 'ngayDiDuKien', 'donDiChung']);
    expect(patchFrom(mk({})).ngayDiDuKien).toBeNull();
  });

  it('Lark đổi ngày đi sang TƯƠNG LAI (kiện hold) → vẫn ghi, khác với labelCreatedAt', () => {
    const mai = new Date(Date.now() + 36 * 3600 * 1000);
    const p = patchFrom(mk({ ngayDiDuKien: mai, labelDate: null }));
    expect(p.ngayDiDuKien).toBe(mai);
    expect(p.labelCreatedAt).toBeUndefined();
  });
});

describe('giaTriTaoKien', () => {
  it('đủ cột cron đang insert + 3 cột mới', () => {
    const v = giaTriTaoKien(mk({ weightKg: 0.5, dims: { l: 10, w: 10, h: null }, trackingNumber: 'T1', carrierKey: 'ups', hop: 'Bag', pieces: 1 }), 'order-1');
    expect(v).toEqual({
      orderId: 'order-1', logUniqueCode: 'PK-1', trackingNumber: 'T1', carrierKey: 'ups',
      actualWeightKg: '0.5', dimLengthCm: '10', dimWidthCm: '10', dimHeightCm: null,
      labelCreatedAt: null, originHub: null, ngayDiDuKien: null, donDiChung: null, larkHop: 'Bag', skuText: null, pieces: 1,
    });
  });
});

describe('kiện gộp nhiều đơn', () => {
  it('đơn thứ hai trở đi lưu ở donDiChung, đơn đầu là đơn chính', () => {
    const row = mk({ orderNumber: '#MBLVD30321', orderNumbers: ['#MBLVD30321', '#MBLVD30322'] });
    expect(patchFrom(row).donDiChung).toEqual(['#MBLVD30322']);
    expect(giaTriTaoKien(row, 'o1').donDiChung).toEqual(['#MBLVD30322']);
  });
  it('kiện một đơn → donDiChung null (gộp rồi tách lại thì mất đi)', () => {
    expect(patchFrom(mk({ orderNumbers: ['#MBLVD1'] })).donDiChung).toBeNull();
  });
});
