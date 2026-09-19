import { describe, it, expect } from 'vitest';
import { ngayLark, docNgayLark, ngayDuKien } from './ngay-lark';
import { larkEpochToVnMidnight } from '../parse-pack-row';

describe('ngayLark', () => {
  it('nửa đêm VN = 17:00 UTC hôm trước', () => {
    // 2026-09-19 10:30 giờ VN = 03:30Z → ngày-lịch VN 19/09 → epoch = 2026-09-18T17:00Z
    expect(ngayLark(new Date('2026-09-19T03:30:00Z'))).toBe(Date.UTC(2026, 8, 18, 17));
  });
  it('mốc 23:30 giờ VN vẫn là ngày hôm đó, không nhảy sang hôm sau', () => {
    expect(ngayLark(new Date('2026-09-19T16:30:00Z'))).toBe(Date.UTC(2026, 8, 18, 17));
    // 00:30 giờ VN ngày 20 (= 17:30Z ngày 19) → ngày 20
    expect(ngayLark(new Date('2026-09-19T17:30:00Z'))).toBe(Date.UTC(2026, 8, 19, 17));
  });
  it('đọc ngược qua larkEpochToVnMidnight ra đúng ngày-lịch', () => {
    const e = ngayLark(new Date('2026-09-19T03:30:00Z'));
    expect(larkEpochToVnMidnight(e).toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });
  it('ngày "giờ-treo VN" của label_created_at (UTC nửa đêm) giữ nguyên ngày', () => {
    expect(larkEpochToVnMidnight(ngayLark(new Date('2026-09-19T00:00:00Z'))).toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });
});

describe('docNgayLark', () => {
  it('số → chính nó; lookup {value:[n]} → n; trống → null', () => {
    expect(docNgayLark(1758214800000)).toBe(1758214800000);
    expect(docNgayLark({ value: [1758214800000] })).toBe(1758214800000);
    expect(docNgayLark(undefined)).toBeNull();
    expect(docNgayLark('')).toBeNull();
  });
});

describe('ngayDuKien', () => {
  it('label + SLA nước (HK = 3 ngày)', () => {
    const e = ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'HK');
    expect(larkEpochToVnMidnight(e).toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });
  it('nước lạ → SLA của miền cuối (không ném lỗi)', () => {
    expect(typeof ngayDuKien(new Date('2026-09-10T00:00:00Z'), 'ZZ')).toBe('number');
  });
});
