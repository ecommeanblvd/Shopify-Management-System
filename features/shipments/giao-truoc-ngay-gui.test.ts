import { describe, it, expect } from 'vitest';
import { lechGiaoTruocNgayGui, tomTatGiaoTruoc, type DongGiaoTruoc } from './giao-truoc-ngay-gui';

describe('lechGiaoTruocNgayGui', () => {
  /* Ca thật PK-21626: vận đơn 876817928550, nhãn 06/09 mà ghi giao 03/09 (giờ VN). */
  it('bắt ca thật lệch 3 ngày', () => {
    expect(lechGiaoTruocNgayGui({
      labelCreatedAt: '2026-09-07T00:00:00Z', deliveredAt: '2026-09-04T02:08:17Z',
    })).toBe(3);
  });
  it('giao sau khi gửi = bình thường → null', () => {
    expect(lechGiaoTruocNgayGui({
      labelCreatedAt: '2026-09-01T00:00:00Z', deliveredAt: '2026-09-08T10:00:00Z',
    })).toBeNull();
  });
  it('giao CÙNG ngày gửi không phải lỗi', () => {
    expect(lechGiaoTruocNgayGui({
      labelCreatedAt: '2026-09-01T00:00:00Z', deliveredAt: '2026-09-01T18:00:00Z',
    })).toBeNull();
  });
  /* Nhãn lưu lúc nửa đêm UTC; giao 02:08 UTC cùng ngày = 09:08 giờ VN CÙNG ngày.
   * So mốc thời gian thô sẽ ra "giao trước" sai; so theo NGÀY giờ VN thì không. */
  it('không báo giả vì múi giờ', () => {
    expect(lechGiaoTruocNgayGui({
      labelCreatedAt: '2026-09-04T00:00:00Z', deliveredAt: '2026-09-04T02:08:17Z',
    })).toBeNull();
  });
  it('thiếu một mốc → null', () => {
    expect(lechGiaoTruocNgayGui({ labelCreatedAt: null, deliveredAt: '2026-09-04T00:00:00Z' })).toBeNull();
    expect(lechGiaoTruocNgayGui({ labelCreatedAt: '2026-09-04T00:00:00Z', deliveredAt: null })).toBeNull();
  });
});

const d = (o: Partial<DongGiaoTruoc>): DongGiaoTruoc => ({
  shipmentId: 'x', tracking: null, carrierKey: 'fedex', deliverySource: 'lark',
  orderNumber: null, dongLark: null, ngayNhan: '2026-09-06', ngayGiao: '2026-09-03', lechNgay: 3, ...o,
});

describe('tomTatGiaoTruoc', () => {
  it('đếm theo nguồn và giữ lệch lớn nhất', () => {
    const t = tomTatGiaoTruoc([
      d({ lechNgay: 3 }), d({ lechNgay: 27 }), d({ lechNgay: 8, deliverySource: 'fedex' }),
    ]);
    expect(t.tong).toBe(3);
    expect(t.lechLonNhat).toBe(27);
    expect(t.theoNguon).toEqual([{ nguon: 'lark', n: 2 }, { nguon: 'fedex', n: 1 }]);
  });
  it('nguồn trống vẫn hiện thành một mục, không biến mất', () => {
    expect(tomTatGiaoTruoc([d({ deliverySource: null })]).theoNguon).toEqual([{ nguon: '(không rõ)', n: 1 }]);
  });
  it('rỗng thì lệch lớn nhất = 0', () => {
    expect(tomTatGiaoTruoc([])).toEqual({ tong: 0, lechLonNhat: 0, theoNguon: [] });
  });
});
