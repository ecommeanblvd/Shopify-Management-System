import { describe, expect, it } from 'vitest';
import { COT_SO_NHAP, LUOI_SO_NHAP, RONG_TOI_THIEU } from './cot-so-nhap';

describe('cột Sổ nhập', () => {
  /* Lệch một ô là lệch cả bảng, và lệch ÂM THẦM — mọi dòng vẫn vẽ bình thường, chỉ sai cột. */
  it('số đường cột khớp số tiêu đề', () => {
    expect(LUOI_SO_NHAP.split(/\s+/)).toHaveLength(COT_SO_NHAP.length);
  });

  it('không cột nào chứa dấu cách trong bề rộng — một dấu cách là thêm một đường cột', () => {
    for (const c of COT_SO_NHAP) expect(c.rong).not.toMatch(/\s/);
  });

  it('tên cột không trùng nhau', () => {
    expect(new Set(COT_SO_NHAP.map((c) => c.ten)).size).toBe(COT_SO_NHAP.length);
  });

  /* Thứ tự THẬT trên bảng Lark: QC Check → Lý do QC failed → Ảnh chụp lỗi QC fail → WH - Action
     (đọc từ API `fields` ngày 03/10/2026). Trang này tồn tại để đối chiếu nên phải cùng hình. */
  it('ba cột QC đứng đúng thứ tự của bảng Lark', () => {
    const t = COT_SO_NHAP.map((c) => c.ten);
    expect(t.indexOf('QC')).toBeLessThan(t.indexOf('Lý do lỗi'));
    expect(t.indexOf('Lý do lỗi')).toBeLessThan(t.indexOf('Ảnh lỗi'));
    expect(t.indexOf('Ảnh lỗi')).toBeLessThan(t.indexOf('Xử lý kho'));
  });

  it('trần bề rộng đủ chứa mọi cột ở mức nhỏ nhất', () => {
    expect(RONG_TOI_THIEU).toBeGreaterThanOrEqual(1800);
  });
});
