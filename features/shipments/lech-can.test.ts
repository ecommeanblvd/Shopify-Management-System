import { describe, it, expect } from 'vitest';
import { canQuyDoi, canTinhCuoc, chamSizeThung, phanLoaiKien, type KienCan } from './lech-can';

const k = (thucKg: number | null, d: number | null, r: number | null, c: number | null, billedKg: number | null): KienCan =>
  ({ thucKg, daiCm: d, rongCm: r, caoCm: c, billedKg });

describe('lech-can — đo chọn sai size thùng', () => {
  it('cân quy đổi = D×R×C/5000; thiếu chiều nào → 0', () => {
    expect(canQuyDoi(40, 30, 20)).toBe(4.8);
    expect(canQuyDoi(40, 30, null)).toBe(0);
  });
  it('cân tính cước = max(cân thực, quy đổi)', () => {
    expect(canTinhCuoc(k(2, 40, 30, 20, null))).toBe(4.8); // quy đổi thắng
    expect(canTinhCuoc(k(6, 40, 30, 20, null))).toBe(6);   // cân thực thắng
    expect(canTinhCuoc(k(null, null, null, null, 3))).toBeNull();
  });
  it('lệch ≥ 0,5 kg là chọn sai thùng; lệch nhỏ là đúng; carrier charge nhẹ hơn thì không phạt', () => {
    expect(phanLoaiKien(k(2, 40, 30, 20, 5.5))).toEqual({ loai: 'sai_thung', lech: 0.7 });
    expect(phanLoaiKien(k(2, 40, 30, 20, 5.0))).toEqual({ loai: 'dung', lech: 0.2 });
    expect(phanLoaiKien(k(2, 40, 30, 20, 4.8))).toEqual({ loai: 'dung', lech: 0 });
    expect(phanLoaiKien(k(2, 40, 30, 20, 4.0))).toEqual({ loai: 'nhe_hon', lech: -0.8 });
    expect(phanLoaiKien(k(2, 40, 30, 20, null)).loai).toBe('thieu_du_lieu');
  });
  it('chamSizeThung: tỉ lệ đúng gồm cả kiện carrier charge nhẹ hơn; cộng kg dôi ra', () => {
    const r = chamSizeThung([
      k(2, 40, 30, 20, 4.8),  // đúng
      k(2, 40, 30, 20, 5.0),  // đúng
      k(2, 40, 30, 20, 5.8),  // sai thùng, dôi 1.0
      k(2, 40, 30, 20, 4.0),  // nhẹ hơn → vẫn tính đúng
      k(null, null, null, null, 3), // thiếu dữ liệu → ngoài mẫu
    ]);
    expect(r.n).toBe(4);
    expect(r.dung).toBe(2); expect(r.nheHon).toBe(1); expect(r.saiThung).toBe(1); expect(r.thieuDuLieu).toBe(1);
    expect(r.tyLeDung).toBeCloseTo(0.75, 5);
    expect(r.kgDoiRa).toBeCloseTo(1.0, 5);
  });
  it('không có kiện nào chấm được → tỉ lệ null', () => {
    expect(chamSizeThung([k(null, null, null, null, null)]).tyLeDung).toBeNull();
  });
});
