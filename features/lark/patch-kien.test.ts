import { describe, it, expect } from 'vitest';
import { patchFrom, giaTriTaoKien } from './patch-kien';
import type { PackRow } from './parse-pack-row';

const mk = (o: Partial<PackRow>): PackRow => ({
  recordId: null,
  orderNumber: '#MBLVD1', orderNumbers: ['#MBLVD1'], logUniqueCode: 'PK-1', weightKg: null, dims: null, trackingNumber: null,
  carrierKey: null, labelDate: null, base: null, ngayDiDuKien: null, ghiChuDon: null, hop: null, hopRecordId: null, skuText: null, pieces: null, warnings: [], ...o,
});

describe('patchFrom', () => {
  it('chỉ ghi trường Lark có giá trị; cân/kích thước thành chuỗi numeric', () => {
    const p = patchFrom(mk({ weightKg: 1.6, dims: { l: 40, w: 30, h: 2 }, hop: 'Box A', skuText: 'X x1', pieces: 2 }));
    expect(p).toMatchObject({ actualWeightKg: '1.6', dimLengthCm: '40', dimWidthCm: '30', dimHeightCm: '2', larkHop: 'Box A', skuText: 'X x1', pieces: 2 });
    expect(p.trackingNumber).toBeUndefined();
    expect(p.updatedAt).toBeInstanceOf(Date);
  });
  it('dòng trống → chỉ có updatedAt và ba cột đồng bộ hẳn theo Lark (kể cả khi Lark xoá)', () => {
    expect(Object.keys(patchFrom(mk({})))).toEqual(['updatedAt', 'ngayDiDuKien', 'larkGhiChuDon', 'cacDonTrongKien']);
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
  it('đủ cột cron đang insert + 3 cột mới + larkRecordId', () => {
    const v = giaTriTaoKien(mk({ weightKg: 0.5, dims: { l: 10, w: 10, h: null }, trackingNumber: 'T1', carrierKey: 'ups', hop: 'Bag', pieces: 1, recordId: 'recABC' }), 'order-1');
    expect(v).toEqual({
      orderId: 'order-1', logUniqueCode: 'PK-1', larkRecordId: 'recABC', trackingNumber: 'T1', carrierKey: 'ups',
      actualWeightKg: '0.5', dimLengthCm: '10', dimWidthCm: '10', dimHeightCm: null,
      labelCreatedAt: null, originHub: null, ngayDiDuKien: null, larkGhiChuDon: null, cacDonTrongKien: null, larkHop: 'Bag', skuText: null, pieces: 1,
    });
  });
});

describe('kiện gộp nhiều đơn', () => {
  it('lưu ĐỦ mọi đơn của kiện (nơi hiển thị tự lọc đơn chính)', () => {
    const row = mk({ orderNumber: '#MBLVD30321', orderNumbers: ['#MBLVD30321', '#MBLVD30322'] });
    expect(patchFrom(row).cacDonTrongKien).toEqual(['#MBLVD30321', '#MBLVD30322']);
    expect(giaTriTaoKien(row, 'o1').cacDonTrongKien).toEqual(['#MBLVD30321', '#MBLVD30322']);
  });
  it('kiện một đơn → null (gộp rồi tách lại thì mất đi)', () => {
    expect(patchFrom(mk({ orderNumbers: ['#MBLVD1'] })).cacDonTrongKien).toBeNull();
  });
});

describe('patchFrom.larkGhiChuDon', () => {
  it('ghi ĐÈ vô điều kiện, kể cả khi Lark bỏ cờ — kiện Invalid phải quay lại được hàng chờ', () => {
    expect(patchFrom(mk({ ghiChuDon: 'Invalid' })).larkGhiChuDon).toBe('Invalid');
    expect(patchFrom(mk({ ghiChuDon: null })).larkGhiChuDon).toBeNull();
    expect('larkGhiChuDon' in patchFrom(mk({ ghiChuDon: null }))).toBe(true);
  });
});

describe('record_id của Lark được lưu xuống kiện', () => {
  /* Đường GHI của Lark (`updateLogRecordFields`) chỉ nhận record_id, không nhận
   * `Log Unique code`. Trước 12/10/2026 không ai lưu nên 0/6.312 kiện ghi ngược được,
   * dù 100% kiện có PK-xxxxx. */
  it('kiện mới mang record_id', () => {
    expect(giaTriTaoKien(mk({ recordId: 'recABC123' }), 'order-1').larkRecordId).toBe('recABC123');
  });
  it('kiện đã có: patch ghi record_id khi dòng Lark mang nó', () => {
    expect(patchFrom(mk({ recordId: 'recABC123' })).larkRecordId).toBe('recABC123');
  });
  /* Không được ghi đè bằng rỗng: chỗ gọi không truyền record (test cũ, đường vào khác)
   * sẽ XOÁ mất giá trị đang lưu, làm kiện mất khả năng ghi ngược. */
  it('không có record_id thì KHÔNG đụng tới ô đang lưu', () => {
    expect('larkRecordId' in patchFrom(mk({ recordId: null }))).toBe(false);
  });
});

describe('bộ khoá patchFrom có thể sinh ra — CHỐT', () => {
  /**
   * `coThayDoi` so patch với các cột được NẠP SẴN ở `sync.ts` và `nhan-mot-dong.ts`.
   * Cột nào không nạp thì giá trị hiện tại là `undefined`, không bao giờ bằng patch
   * → lượt đồng bộ ghi lại dòng đó MỌI LƯỢT, mãi mãi (đúng hồi quy 3.770 lệnh/lượt
   * đã sửa 05/09/2026).
   *
   * Thêm khoá mới ở `patchFrom` thì PHẢI nạp thêm cột cùng tên ở hai chỗ đó, rồi mới
   * sửa test này.
   */
  it('đúng bộ khoá đang có', () => {
    const day = mk({
      recordId: 'rec1', weightKg: 1, dims: { l: 1, w: 2, h: 3 }, trackingNumber: 'T',
      carrierKey: 'ups', labelDate: new Date(0), base: 'SG', hop: 'Bag', skuText: 'S', pieces: 2,
      orderNumbers: ['#A', '#B'],
    });
    expect(Object.keys(patchFrom(day)).sort()).toEqual([
      'actualWeightKg', 'cacDonTrongKien', 'carrierKey', 'dimHeightCm', 'dimLengthCm', 'dimWidthCm',
      'labelCreatedAt', 'larkGhiChuDon', 'larkHop', 'larkRecordId', 'ngayDiDuKien', 'originHub',
      'pieces', 'skuText', 'trackingNumber', 'updatedAt',
    ]);
  });
});
