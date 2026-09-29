import { describe, it, expect } from 'vitest';
import { ngayKinhDoanh, thangKinhDoanh, sqlGioKinhDoanh, hienNgay, MUI_GIO_KINH_DOANH, dichNgay } from './timezone';

describe('ngayKinhDoanh', () => {
  it('đơn đặt tối giờ VN vẫn thuộc ngày đó, dù UTC đã lùi sang hôm trước', () => {
    // 2026-03-04 00:30 UTC = 2026-03-04 07:30 giờ VN
    expect(ngayKinhDoanh('2026-03-04T00:30:00Z')).toBe('2026-03-04');
    // 2026-03-03 18:00 UTC = 2026-03-04 01:00 giờ VN → phải là NGÀY 04
    expect(ngayKinhDoanh('2026-03-03T18:00:00Z')).toBe('2026-03-04');
  });

  it('ca TA2079 thật: Shopify ghi 01/04, UTC ghi 31/03 → phải theo Shopify', () => {
    // 2026-03-31 17:30 UTC = 2026-04-01 00:30 giờ VN
    expect(ngayKinhDoanh('2026-03-31T17:30:00Z')).toBe('2026-04-01');
    expect(thangKinhDoanh('2026-03-31T17:30:00Z')).toBe('2026-04');
  });

  it('giữa ngày thì không đổi', () => {
    expect(ngayKinhDoanh('2026-03-15T05:00:00Z')).toBe('2026-03-15');
  });

  it('null / ngày hỏng → null', () => {
    expect(ngayKinhDoanh(null)).toBeNull();
    expect(ngayKinhDoanh('không phải ngày')).toBeNull();
  });
});

describe('sqlGioKinhDoanh', () => {
  it('phải là HAI bước AT TIME ZONE — một bước là sai ngược', () => {
    const s = sqlGioKinhDoanh('o.processed_at_shopify');
    expect(s).toBe(`(o.processed_at_shopify AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')`);
    expect(s.match(/AT TIME ZONE/g)).toHaveLength(2);
    expect(s).toContain("'UTC'");
  });
});

describe('hằng số', () => {
  it('chỉ MỘT múi giờ nghiệp vụ', () => expect(MUI_GIO_KINH_DOANH).toBe('Asia/Bangkok'));
});

describe('hienNgay', () => {
  it('thiếu ngày → gạch ngang, không nổ', () => {
    expect(hienNgay(null)).toBe('—');
    expect(hienNgay('rác')).toBe('—');
  });
});

describe('dichNgay — nút chuyển ngày Sổ nhập (CEO 29/09/2026)', () => {
  it('CA LỖI THẬT: lùi một ngày từ Thứ Ba 29/09 phải ra Thứ Hai 28/09, không phải Chủ Nhật 27/09', () => {
    expect(dichNgay('2026-09-29', -1)).toBe('2026-09-28');
  });

  it('CA LỖI THẬT: tiến một ngày phải nhúc nhích, không đứng im', () => {
    expect(dichNgay('2026-09-27', 1)).toBe('2026-09-28');
    expect(dichNgay('2026-09-28', 1)).toBe('2026-09-29');
  });

  it('lùi rồi tiến phải về đúng chỗ cũ — đi được thì về được', () => {
    for (const d of ['2026-01-01', '2026-03-01', '2026-09-29', '2026-12-31']) {
      expect(dichNgay(dichNgay(d, -1), 1)).toBe(d);
    }
  });

  it('biên THÁNG', () => {
    expect(dichNgay('2026-10-01', -1)).toBe('2026-09-30');
    expect(dichNgay('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('biên NĂM', () => {
    expect(dichNgay('2026-01-01', -1)).toBe('2025-12-31');
    expect(dichNgay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('năm nhuận', () => {
    expect(dichNgay('2028-03-01', -1)).toBe('2028-02-29');
    expect(dichNgay('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('bước lớn và bước 0', () => {
    expect(dichNgay('2026-09-29', -7)).toBe('2026-09-22');
    expect(dichNgay('2026-09-29', 0)).toBe('2026-09-29');
  });

  it('chuỗi hỏng → trả nguyên, không ném', () => {
    expect(dichNgay('rác', -1)).toBe('rác');
    expect(dichNgay('', 1)).toBe('');
  });
});
