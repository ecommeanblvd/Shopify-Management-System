import { describe, it, expect } from 'vitest';
import { mocLayHang, mocLayHangUps } from './ngay-lay-hang';

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

describe('mocLayHangUps', () => {
  /* UPS dùng mã trạng thái `P` cho CẢ lượt lấy hàng lẫn lượt ra xe giao (phân biệt bằng mô
     tả), nên lấy `P` SỚM NHẤT — lượt đi đầu tiên. Xem bảng mã ở `lib/ups/track.ts`. */
  it('lấy sự kiện P sớm nhất', () => {
    expect(mocLayHangUps([
      { eventType: 'P', date: '2026-09-25T10:00:00' },
      { eventType: 'P', date: '2026-09-21T08:30:00' },
      { eventType: 'D', date: '2026-09-28T09:00:00' },
    ])?.toISOString().slice(0, 10)).toBe('2026-09-21');
  });

  /* Lịch sử THẬT của 1Z2050VDD934421981: M (tạo nhãn) 14:08 rồi P (Pickup Scan) 15:46.
     Phải lấy P, không lấy M — M là mốc tạo nhãn, đúng thứ đã làm `shipped_at` lệch 3 ngày. */
  it('có P thì KHÔNG lấy M dù M sớm hơn', () => {
    expect(mocLayHangUps([
      { eventType: 'M', date: '2026-09-21T14:08:51' },
      { eventType: 'P', date: '2026-09-21T15:46:35' },
    ])?.toISOString().slice(0, 16)).toBe('2026-09-21T08:46');
  });

  /* Lịch sử THẬT của 1Z2050VDD932029623: KHÔNG có P nào — đi thẳng M → X → I (Export Scan).
     Đo 03/10/2026: chỉ 1 trong 5 lô UPS có P. */
  it('không có P thì lùi về I sớm nhất, vẫn KHÔNG lấy M', () => {
    const r = mocLayHangUps([
      { eventType: 'M', date: '2026-09-22T14:19:16' },
      { eventType: 'X', date: '2026-09-22T06:30:26' },
      { eventType: 'I', date: '2026-09-22T19:49:33' },
      { eventType: 'I', date: '2026-09-23T00:57:00' },
    ]);
    expect(r?.toISOString()).toBe(new Date('2026-09-22T19:49:33').toISOString());
  });

  it('chỉ có M → null, KHÔNG rơi về mốc tạo nhãn', () => {
    expect(mocLayHangUps([{ eventType: 'M', date: '2026-09-22T14:19:16' }])).toBeNull();
    expect(mocLayHangUps([])).toBeNull();
  });

  it('ngày hỏng thì bỏ qua', () => {
    expect(mocLayHangUps([{ eventType: 'P', date: 'khong-phai-ngay' }])).toBeNull();
  });
});
