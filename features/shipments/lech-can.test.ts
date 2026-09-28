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

describe('kiện đã có chứng từ điều chỉnh của hãng (CEO 28/09/2026)', () => {
  /* #MBLVD29877: cân thực 0,9 kg, FedEx ghi 9,4 kg rồi trả lại 4.002.767/4.353.468đ
     bằng giấy báo có 1K26TFA/45602. Hoá đơn làm căn cứ đã bị chính hãng huỷ một
     phần nên không chấm kho sai thùng. */
  const kien = { thucKg: 0.9, daiCm: null, rongCm: null, caoCm: null, billedKg: 9.4 };

  it('không có chứng từ → vẫn là sai thùng', () => {
    expect(phanLoaiKien(kien).loai).toBe('sai_thung');
  });

  it('có chứng từ điều chỉnh → chuyển sang "đã điều chỉnh"', () => {
    expect(phanLoaiKien({ ...kien, daDieuChinh: true }).loai).toBe('da_dieu_chinh');
  });

  it('VẪN giữ số lệch để bảng chi tiết hiện được con số gốc', () => {
    expect(phanLoaiKien({ ...kien, daDieuChinh: true }).lech).toBe(8.5);
  });

  it('kiện ĐÚNG size mà có chứng từ điều chỉnh thì vẫn là đúng — cờ chỉ gỡ án sai thùng', () => {
    expect(phanLoaiKien({ thucKg: 2, daiCm: null, rongCm: null, caoCm: null, billedKg: 2.1, daDieuChinh: true }).loai).toBe('dung');
  });

  it('KHÔNG cộng vào kg dôi và KHÔNG vào mẫu số — bằng chứng bị hãng rút thì không chấm ai', () => {
    const r = chamSizeThung([
      { thucKg: 1, daiCm: null, rongCm: null, caoCm: null, billedKg: 3 },
      { ...kien, daDieuChinh: true },
      { thucKg: 2, daiCm: null, rongCm: null, caoCm: null, billedKg: 2 },
    ]);
    expect(r.saiThung).toBe(1);
    expect(r.daDieuChinh).toBe(1);
    expect(r.n).toBe(2);
    expect(r.kgDoiRa).toBe(2);
    expect(r.tyLeDung).toBe(0.5);
  });
});
