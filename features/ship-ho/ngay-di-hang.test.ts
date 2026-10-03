import { describe, it, expect } from 'vitest';
import { ngayDiHang } from './ngay-di-hang';

describe('ngayDiHang', () => {
  /* AWB 873918787369 THẬT: FedEx quét PU 06/07, còn `shipped_at` ghi 03/07 (mốc tạo nhãn).
     Phụ phí xăng dầu tính theo tuần của NGÀY ĐI, nên phải lấy 06/07. */
  it('có ngày hãng thì lấy ngày hãng', () => {
    expect(ngayDiHang({ pickedUpAt: new Date(2026, 6, 6, 14, 52), shippedAt: '2026-07-03' }))
      .toEqual({ ngay: '2026-07-06', nguon: 'hang' });
  });

  /* Aramex HN không có API tra cứu (CEO chốt 03/10): rơi về ngày Đức điền trên Lark, nhưng
     nguồn phải nói ra — ngoại lệ KHAI BÁO, không phải rơi-về im lặng. */
  it('không có ngày hãng thì lấy ngày Lark và khai nguồn', () => {
    expect(ngayDiHang({ pickedUpAt: null, shippedAt: '2026-09-21' }))
      .toEqual({ ngay: '2026-09-21', nguon: 'lark' });
  });

  it('không có ngày nào thì trả null, KHÔNG bịa', () => {
    expect(ngayDiHang({ pickedUpAt: null, shippedAt: null })).toEqual({ ngay: null, nguon: 'lark' });
  });

  /* Cột `picked_up_at` là timestamp không múi giờ; đọc bằng giờ địa phương để không lệch ngày
     (bài học D-194 — `toISOString` quy sang UTC làm lệch một ngày). */
  it('Date gần nửa đêm vẫn ra đúng ngày treo tường', () => {
    expect(ngayDiHang({ pickedUpAt: new Date(2026, 6, 6, 23, 59), shippedAt: null }).ngay).toBe('2026-07-06');
    expect(ngayDiHang({ pickedUpAt: new Date(2026, 6, 6, 0, 1), shippedAt: null }).ngay).toBe('2026-07-06');
  });

  it('chuỗi ngày cũng nhận', () => {
    expect(ngayDiHang({ pickedUpAt: '2026-07-06 14:52:00', shippedAt: null }).ngay).toBe('2026-07-06');
  });
});
