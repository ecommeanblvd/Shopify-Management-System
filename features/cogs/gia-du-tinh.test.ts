import { describe, it, expect } from 'vitest';
import { cacKhoaSku, ckTheoBrand, cungBrand, maSanPham, uocGiaVon, uocGiaVonDuTinh, uocGiaVonTuLichSu } from './gia-du-tinh';

describe('gia-du-tinh', () => {
  it('cacKhoaSku: nguyên + bỏ tiền tố', () => {
    expect(cacKhoaSku('Denio-DN0713-S-BLA')).toEqual(['denio-dn0713-s-bla', 'dn0713-s-bla']);
    expect(cacKhoaSku('DN0713-S-BLA')).toEqual(['dn0713-s-bla', 's-bla']);
    expect(cacKhoaSku('ABC')).toEqual(['abc']);
  });
  it('cungBrand: vendor ↔ slug bỏ ký tự, tiền tố ≥ 3', () => {
    expect(cungBrand('Calista de Minh Thanh', 'calista-de-minh-thanh')).toBe(true);
    expect(cungBrand('I.H.F Atelier', 'i-h-f')).toBe(true);
    expect(cungBrand('White Plan', 'white-chic')).toBe(false);
    expect(cungBrand('DC', 'december-chris')).toBe(false);
  });
  it('ckTheoBrand: mode; hoà lấy mức lớn hơn; bỏ ck ngoài (0,1)', () => {
    const m = ckTheoBrand([{ brandSlug: 'denio', ck: 0.4 }, { brandSlug: 'denio', ck: 0.4 }, { brandSlug: 'denio', ck: 0.25 }, { brandSlug: 'poem', ck: 0.25 }, { brandSlug: 'poem', ck: 0.3 }, { brandSlug: 'x', ck: null }, { brandSlug: 'x', ck: 1 }]);
    expect(m.get('denio')).toBe(0.4); expect(m.get('poem')).toBe(0.3); expect(m.has('x')).toBe(false);
  });
  it('uocGiaVonDuTinh: khớp SKU bỏ tiền tố, cùng brand; giá = niêm yết × (1 − CK); lý do không ước', () => {
    const variants = [
      { brandSlug: 'denio', sku: 'DN0713-S-BLA', price: 1_190_000 },
      { brandSlug: 'decos', sku: 'decos-FW20-D001-XS-PIN', price: 2_000_000 },
      { brandSlug: 'poem', sku: 'P1-S', price: 900_000 },
      { brandSlug: 'x-brand', sku: 'DN0713-S-BLA', price: 500_000 }, // cùng SKU brand khác — không được lấy
      { brandSlug: 'denio', sku: 'RAC-1', price: 1_080_384_615 }, // giá rác → bỏ
    ];
    const ck = new Map([['denio', 0.4], ['decos', 0.25]]);
    const { uoc, khong } = uocGiaVonDuTinh([
      { sku: 'Denio-DN0713-S-BLA', vendor: 'DeNio' }, { sku: 'Decos-FW20-D001-XS-PIN', vendor: 'Decos' },
      { sku: 'Poem-P1-S', vendor: 'POEM' }, { sku: 'Denio-KHONGCO-M', vendor: 'DeNio' }, { sku: 'Larmes-L1', vendor: 'Larmes' },
    ], variants, ck);
    expect(uoc).toEqual([
      { sku: 'Denio-DN0713-S-BLA', brandSlug: 'denio', giaNiemYet: 1_190_000, ck: 0.4, giaVon: 714_000, nguon: 'mmp_vnd_x_ck' },
      { sku: 'Decos-FW20-D001-XS-PIN', brandSlug: 'decos', giaNiemYet: 2_000_000, ck: 0.25, giaVon: 1_500_000, nguon: 'mmp_vnd_x_ck' },
    ]);
    expect(khong).toEqual([
      { sku: 'Poem-P1-S', vendor: 'POEM', lyDo: 'brand_chua_co_ck' },
      { sku: 'Denio-KHONGCO-M', vendor: 'DeNio', lyDo: 'chua_co_gia' },
      { sku: 'Larmes-L1', vendor: 'Larmes', lyDo: 'chua_co_gia' },
    ]);
    expect(uocGiaVon(1_190_000, 0.4)).toBe(714_000);
  });
});

describe('gia-du-tinh — CK brand họ hàng', () => {
  it('vendor I.H.F Atelier khớp biến thể brand i-h-f-atelier (không CK) → lấy CK của i-h-f', () => {
    const { uoc } = uocGiaVonDuTinh([{ sku: 'IHF.Atelier-A1-S', vendor: 'I.H.F Atelier' }], [{ brandSlug: 'i-h-f-atelier', sku: 'A1-S', price: 1_000_000 }], new Map([['i-h-f', 0.5]]));
    expect(uoc[0]?.giaVon).toBe(500_000);
  });
});

describe('gia-du-tinh — lịch sử bảng kê', () => {
  it('maSanPham: cắt trước token size', () => {
    expect(maSanPham('Denio-DN0713-S-BLA')).toBe('denio-dn0713');
    expect(maSanPham('Lamai-LM-25A042-XL-IVW-PDO')).toBe('lamai-lm-25a042');
    expect(maSanPham('Beloved-RS25-JuliaTop-1-PPU')).toBe('beloved-rs25-juliatop-1-ppu');
    expect(maSanPham('Calista-VLUMI01-Customize-BBLA')).toBe('calista-vlumi01');
    expect(maSanPham('LaVierge-RS25-18-S-DSP')).toBe('lavierge-rs25-18');
  });
  it('ưu tiên đúng SKU kỳ mới nhất, rồi cùng mã sản phẩm cùng brand; còn lại trả về conLai', () => {
    const lichSu = [
      { sku: 'Denio-DN0713-S-BLA', vendor: 'DeNio', unitVnd: 700_000, period: '2026-03' },
      { sku: 'Denio-DN0713-S-BLA', vendor: 'DeNio', unitVnd: 714_000, period: '2026-05' },
      { sku: 'Lamai-LM-25A042-XL-IVW-PDO', vendor: 'LaMai Atelier', unitVnd: 1_462_500, period: '2026-07' },
    ];
    const { uoc, conLai } = uocGiaVonTuLichSu([
      { sku: 'Denio-DN0713-S-BLA', vendor: 'DeNio' }, { sku: 'Lamai-LM-25A042-S-IVW-PDO', vendor: 'LaMai Atelier' },
      { sku: 'Cordia-X1-S', vendor: 'Cordia' }, { sku: 'Denio-DN0713-S-BLA', vendor: 'Poem' },
    ], lichSu);
    expect(uoc).toEqual([
      { sku: 'Denio-DN0713-S-BLA', giaVon: 714_000, nguon: 'lich_su_sku', theoSku: 'Denio-DN0713-S-BLA', period: '2026-05' },
      { sku: 'Lamai-LM-25A042-S-IVW-PDO', giaVon: 1_462_500, nguon: 'lich_su_ma_sp', theoSku: 'Lamai-LM-25A042-XL-IVW-PDO', period: '2026-07' },
      { sku: 'Denio-DN0713-S-BLA', giaVon: 714_000, nguon: 'lich_su_sku', theoSku: 'Denio-DN0713-S-BLA', period: '2026-05' },
    ]);
    expect(conLai).toEqual([{ sku: 'Cordia-X1-S', vendor: 'Cordia' }]);
  });
});
