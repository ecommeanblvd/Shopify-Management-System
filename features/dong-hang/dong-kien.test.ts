import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LY_DO_DONG, kiemDongKien, laDonInvalid, lyDoDongHopLe, nhanLyDoDong,
} from './dong-kien';

describe('laDonInvalid', () => {
  it('cột LOG-Order Remark (Full) = "Invalid" → đơn sẽ không bao giờ đi', () => {
    expect(laDonInvalid('Invalid')).toBe(true);
  });

  it('không phân biệt hoa thường và khoảng trắng — Lark hay để lọt dấu cách', () => {
    expect(laDonInvalid('  invalid ')).toBe(true);
    expect(laDonInvalid('INVALID')).toBe(true);
  });

  it('"Address Checked" là đơn BÌNH THƯỜNG, phải ở lại hàng chờ', () => {
    expect(laDonInvalid('Address Checked')).toBe(false);
  });

  it('trống / null → KHÔNG coi là Invalid (thiếu dữ liệu không được tự đóng việc)', () => {
    for (const v of [null, undefined, '', '   ']) expect(laDonInvalid(v)).toBe(false);
  });

  it('chuỗi chỉ CHỨA chữ invalid nhưng nghĩa khác → không tính', () => {
    expect(laDonInvalid('Invalid address fixed')).toBe(false);
    expect(laDonInvalid('Re-check invalid')).toBe(false);
  });
});

describe('lyDoDongHopLe', () => {
  it('bốn lý do CEO chốt 28/09/2026', () => {
    expect(LY_DO_DONG.map((l) => l.ma)).toEqual(['giao_tay', 'dong_trung', 'don_huy', 'khac']);
  });

  it('lý do lạ → không hợp lệ', () => {
    expect(lyDoDongHopLe('bia_ra')).toBe(false);
    expect(lyDoDongHopLe('')).toBe(false);
  });

  it('mỗi lý do có nhãn tiếng Việt đọc được', () => {
    for (const l of LY_DO_DONG) expect(nhanLyDoDong(l.ma).length).toBeGreaterThan(3);
  });
});

describe('kiemDongKien', () => {
  const ok = { lyDo: 'giao_tay', ghiChu: null, kienThayThe: null };

  it('giao tận tay: không cần ghi chú', () => {
    expect(kiemDongKien(ok)).toBeNull();
  });

  it('lý do "khác" BẮT BUỘC ghi chú — sau này còn đọc lại hiểu vì sao', () => {
    expect(kiemDongKien({ lyDo: 'khac', ghiChu: null, kienThayThe: null }))
      .toMatch(/ghi chú/i);
    expect(kiemDongKien({ lyDo: 'khac', ghiChu: '   ', kienThayThe: null }))
      .toMatch(/ghi chú/i);
    expect(kiemDongKien({ lyDo: 'khac', ghiChu: 'Hàng mẫu giữ lại showroom', kienThayThe: null }))
      .toBeNull();
  });

  it('lý do "dòng trùng" BẮT BUỘC chỉ ra kiện đã đi — để còn truy ngược', () => {
    expect(kiemDongKien({ lyDo: 'dong_trung', ghiChu: null, kienThayThe: null }))
      .toMatch(/kiện/i);
    expect(kiemDongKien({ lyDo: 'dong_trung', ghiChu: null, kienThayThe: 'PK-18803' }))
      .toBeNull();
  });

  it('không cho tự chỉ về CHÍNH nó', () => {
    expect(kiemDongKien({ lyDo: 'dong_trung', ghiChu: null, kienThayThe: 'PK-18801' }, 'PK-18801'))
      .toMatch(/chính nó/i);
  });

  it('lý do không hợp lệ → báo lỗi, không im lặng bỏ qua', () => {
    expect(kiemDongKien({ lyDo: 'bia_ra', ghiChu: null, kienThayThe: null })).toMatch(/lý do/i);
  });
});

describe('luật Invalid trong SQL phải khớp hàm thuần', () => {
  const src = readFileSync(new URL('./queries.ts', import.meta.url), 'utf8');

  it('dùng SO SÁNH BẰNG, không dùng LIKE — "Invalid address fixed" nghĩa ngược mà LIKE vẫn dính', () => {
    const dong = src.split('\n').filter((l) => /lark_ghi_chu_don|larkGhiChuDon/.test(l));
    expect(dong.length).toBeGreaterThan(0);
    for (const l of dong) expect(l).not.toMatch(/like|ilike|%/i);
  });

  it('SQL chuẩn hoá y như hàm thuần: bỏ khoảng trắng hai đầu và hạ chữ thường', () => {
    for (const ten of ['LA_INVALID', 'KHONG_INVALID']) {
      const m = new RegExp(`const ${ten} = sql\`([^\`]+)\``).exec(src);
      expect(m, `không thấy ${ten}`).not.toBeNull();
      const bieu_thuc = m![1]!;
      expect(bieu_thuc).toContain('lower(');
      expect(bieu_thuc).toContain('trim(');
      expect(bieu_thuc).toContain("'invalid'");
      // coalesce: cột NULL không được làm cả vế so sánh thành NULL rồi loại nhầm dòng.
      expect(bieu_thuc).toContain('coalesce(');
    }
  });

  it('hàm thuần đồng ý với các giá trị SQL sẽ gặp', () => {
    expect(laDonInvalid('  INVALID  ')).toBe(true);
    expect(laDonInvalid('Address Checked')).toBe(false);
  });
});
