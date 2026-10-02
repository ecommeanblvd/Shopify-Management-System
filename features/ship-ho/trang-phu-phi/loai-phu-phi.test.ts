import { describe, it, expect } from 'vitest';
import { loaiChoPhep, NHAN_DONG } from './loai-phu-phi';

describe('loaiChoPhep', () => {
  /* Hàng rào quan trọng nhất của cả tính năng: markup_percent là LÃI của MEAN (dữ liệu thật
     02/10/2026: FedEx 4 dòng, DHL 4 dòng). Lộ ra là lộ lãi. */
  it('markup_percent → null, KHÔNG BAO GIỜ lên trang', () => {
    expect(loaiChoPhep('markup_percent', null)).toBeNull();
    expect(loaiChoPhep('markup_percent', 'direct_signature')).toBeNull();
  });

  /* Danh sách CHO PHÉP, không phải loại trừ: thêm một kind mới vào enum thì nó mặc định bị
     loại, thay vì lọt ra ngoài mà không ai thấy. */
  it('kind lạ → null, mặc định bị loại', () => {
    expect(loaiChoPhep('kind_moi_nao_do', null)).toBeNull();
    expect(loaiChoPhep('', null)).toBeNull();
  });

  /* `processing` là phí của MEAN (price-structure dựng nó với costVnd/billVnd null — không
     hãng nào thu MEAN khoản đó), nên không thuộc tiền đề "dẫn nguồn hãng". */
  it('processing KHÔNG nằm trong bảng ánh xạ — phí của MEAN, không có nguồn hãng', () => {
    expect(loaiChoPhep('processing', null)).toBeNull();
  });

  it('các loại pass-through → đúng dòng bảng kê', () => {
    expect(loaiChoPhep('fuel_percent', null)?.dong).toBe('fuel');
    expect(loaiChoPhep('remote_fixed', null)?.dong).toBe('remote');
    expect(loaiChoPhep('demand_per_kg', null)?.dong).toBe('demand');
    expect(loaiChoPhep('residential_fixed', null)?.dong).toBe('residential');
    expect(loaiChoPhep('vat_percent', null)?.dong).toBe('vat');
  });

  /* addon_fixed rẽ theo service_key: direct_signature là dòng "Ký nhận" trên bảng kê, còn
     addon khác gom vào "Phụ phí khác". Cùng kind, hai dòng. */
  it('addon_fixed rẽ theo service_key', () => {
    expect(loaiChoPhep('addon_fixed', 'direct_signature')?.dong).toBe('signature');
    expect(loaiChoPhep('addon_fixed', null)?.dong).toBe('other');
    expect(loaiChoPhep('addon_fixed', 'dich_vu_khac')?.dong).toBe('other');
  });

  it('các loại lẻ gom vào "Phụ phí khác"', () => {
    for (const k of ['peak_fixed', 'per_kg_fixed', 'per_step_fixed', 'country_fixed', 'packaging_fixed']) {
      expect(loaiChoPhep(k, null)?.dong).toBe('other');
    }
  });

  it('mọi loại được phép đều có nhãn và cách tính, không dòng nào rỗng', () => {
    for (const k of ['fuel_percent', 'remote_fixed', 'demand_per_kg', 'residential_fixed',
      'vat_percent', 'peak_fixed', 'per_kg_fixed', 'per_step_fixed', 'country_fixed',
      'packaging_fixed', 'addon_fixed']) {
      const m = loaiChoPhep(k, null)!;
      expect(m, k).not.toBeNull();
      expect(m.nhan.length, k).toBeGreaterThan(0);
      expect(m.cachTinh.length, k).toBeGreaterThan(0);
    }
  });

  it('mỗi dòng bảng kê có nhãn tiếng Việt', () => {
    for (const d of ['fuel', 'remote', 'demand', 'residential', 'signature', 'vat', 'other'] as const) {
      expect(NHAN_DONG[d].length).toBeGreaterThan(0);
    }
  });
});
