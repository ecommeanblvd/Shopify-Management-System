import { describe, it, expect } from 'vitest';
import { ngayKinhDoanh, thangKinhDoanh, sqlGioKinhDoanh, hienNgay, MUI_GIO_KINH_DOANH } from './timezone';

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
