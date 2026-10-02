import { describe, it, expect } from 'vitest';
import { mocLayHang } from './ngay-lay-hang';

describe('mocLayHang', () => {
  /* Lịch sử THẬT của AWB 873918787369 (02/10/2026). `shipped_at` của SMS ghi 03/07 — đó là
     mốc OC, không phải mốc hàng đi. */
  const that = [
    { eventType: 'OC', date: '2026-07-03T05:31:10' },
    { eventType: 'PU', date: '2026-07-06T14:52:00' },
    { eventType: 'DP', date: '2026-07-06T19:30:00' },
    { eventType: 'DL', date: '2026-07-08T09:51:00' },
  ];
  it('lấy mốc PU, không lấy OC cũng không lấy DL', () => {
    expect(mocLayHang(that)?.toISOString().slice(0, 10)).toBe('2026-07-06');
  });
  /* Lô bị trả rồi gửi lại có hai lần PU; cước tính theo lượt ĐI ĐẦU TIÊN. */
  it('hai lần PU thì lấy lần SỚM NHẤT', () => {
    expect(mocLayHang([
      { eventType: 'PU', date: '2026-07-20T10:00:00' },
      { eventType: 'PU', date: '2026-07-06T14:52:00' },
    ])?.toISOString().slice(0, 10)).toBe('2026-07-06');
  });
  it('không có PU → null, không rơi về sự kiện khác', () => {
    expect(mocLayHang([{ eventType: 'OC', date: '2026-07-03T05:31:10' }])).toBeNull();
    expect(mocLayHang([])).toBeNull();
  });
  it('ngày hỏng thì bỏ qua, không trả Invalid Date', () => {
    expect(mocLayHang([{ eventType: 'PU', date: 'khong-phai-ngay' }])).toBeNull();
    expect(mocLayHang([{ eventType: 'PU', date: null }])).toBeNull();
  });
});
