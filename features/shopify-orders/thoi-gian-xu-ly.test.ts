import { describe, it, expect } from 'vitest';
import { rutThoiGianXuLy } from './thoi-gian-xu-ly';

const dong = (b: string | null, e: string | null, attr?: { key: string; value: string | null }[]) =>
  ({ product: { b: b == null ? null : { value: b }, e: e == null ? null : { value: e } },
     customAttributes: attr ?? [] });

describe('rutThoiGianXuLy', () => {
  it('lấy đúng số ngày từ metafield sản phẩm', () => {
    const r = rutThoiGianXuLy(dong('8', '14'));
    expect(r.soNgayMin).toBe(8);
    expect(r.soNgayMax).toBe(14);
  });

  it('lấy "Estimated Delivery" từ thuộc tính của DÒNG, không phân biệt hoa thường', () => {
    const r = rutThoiGianXuLy(dong('8', '14', [{ key: 'Estimated Delivery', value: '7 October - 22 October' }]));
    expect(r.duKienGiao).toBe('7 October - 22 October');
    expect(rutThoiGianXuLy(dong(null, null, [{ key: 'estimated delivery', value: 'X' }])).duKienGiao).toBe('X');
  });

  /* Đơn chỉ có thuộc tính marketing (mrm_first_touch, utm_*) thì không được
   * nhặt bừa cái nào — đo thật: meanblvd 31/35 dòng có, tinhatelier 0/14. */
  it('không có thuộc tính đó thì trả null, không nhặt bừa', () => {
    const r = rutThoiGianXuLy(dong('8', '14', [{ key: 'utm_source', value: 'meta' }]));
    expect(r.duKienGiao).toBeNull();
  });

  /* Metafield gõ sai mà ghi xuống là kho đọc thấy "-3 ngày" hoặc "abc ngày". */
  it('giá trị không phải số nguyên hợp lệ thì bỏ', () => {
    expect(rutThoiGianXuLy(dong('abc', '14')).soNgayMin).toBeNull();
    expect(rutThoiGianXuLy(dong('-3', '14')).soNgayMin).toBeNull();
    expect(rutThoiGianXuLy(dong('8', '999')).soNgayMax).toBeNull();
    expect(rutThoiGianXuLy(dong('2.5', '14')).soNgayMin).toBeNull();
  });

  it('ghi ngược min/max thì đảo lại, không bịa', () => {
    const r = rutThoiGianXuLy(dong('14', '8'));
    expect([r.soNgayMin, r.soNgayMax]).toEqual([8, 14]);
  });

  it('thiếu hẳn metafield → null cả hai, không ném', () => {
    expect(rutThoiGianXuLy({})).toEqual({ soNgayMin: null, soNgayMax: null, duKienGiao: null });
  });

  it('chỉ có một đầu thì giữ đúng đầu đó', () => {
    expect(rutThoiGianXuLy(dong('8', null)).soNgayMin).toBe(8);
    expect(rutThoiGianXuLy(dong('8', null)).soNgayMax).toBeNull();
  });
});
