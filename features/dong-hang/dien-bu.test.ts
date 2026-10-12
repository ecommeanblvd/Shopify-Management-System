import { describe, it, expect } from 'vitest';
import { canDienBu, MOC_DIEN_BU } from './dien-bu';

describe('canDienBu', () => {
  const goc = {
    trackingNumber: 'T', larkRecordId: 'rec', daGhiGiaLuc: null,
    taoLuc: new Date(MOC_DIEN_BU.getTime() + 86_400_000),
  };

  it('có tracking + có record Lark + chưa ghi giá + tạo sau mốc → cần', () => {
    expect(canDienBu(goc)).toBe(true);
  });
  it('chưa có tracking → chưa tới lượt', () => {
    expect(canDienBu({ ...goc, trackingNumber: null })).toBe(false);
  });
  it('chưa có record Lark → chưa ghi được', () => {
    expect(canDienBu({ ...goc, larkRecordId: null })).toBe(false);
  });
  it('đã ghi rồi → thôi', () => {
    expect(canDienBu({ ...goc, daGhiGiaLuc: new Date() })).toBe(false);
  });

  /* C3: ba điều kiện kia đúng với 4.276 kiện trải 4 tháng lịch sử (đo thật, sớm nhất
   * 10/06/2026). Không có mốc thì lượt cron đầu tiên đổ giá ước tính hôm nay lên 4 tháng dòng
   * Lark cũ và lấp vĩnh viễn mọi ô trống còn lại — "kiện lỡ nhịp" là kiện VỪA dán mã qua luồng
   * mới, không phải toàn bộ lịch sử. */
  it('kiện tạo TRƯỚC mốc (lịch sử) → KHÔNG đụng, dù thoả mọi điều kiện khác', () => {
    expect(canDienBu({ ...goc, taoLuc: new Date(MOC_DIEN_BU.getTime() - 1) })).toBe(false);
    expect(canDienBu({ ...goc, taoLuc: new Date('2026-06-10T00:00:00.000Z') })).toBe(false);
  });
  it('kiện tạo ĐÚNG mốc → nằm trong phạm vi', () => {
    expect(canDienBu({ ...goc, taoLuc: new Date(MOC_DIEN_BU.getTime()) })).toBe(true);
  });
  /* Không biết kiện thuộc thời nào thì không ghi — cùng hướng với mọi lựa chọn khác ở đây. */
  it('không đọc được ngày tạo → KHÔNG đụng', () => {
    expect(canDienBu({ ...goc, taoLuc: null })).toBe(false);
  });
});
