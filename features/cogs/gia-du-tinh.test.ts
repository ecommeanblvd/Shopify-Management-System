import { describe, it, expect } from 'vitest';
import { cacKhoaSku, ckTheoBrand, ckTheoBrandKy, cungBrand, cungMucCk, dongGiaTheoKy, ghiChuGiaDuTinh, laMucTierBrand, kyCkTuNguon, maSanPham, nguonTheoKy, uocGiaVon, uocGiaVonDuTinh, uocGiaVonTuLichSu } from './gia-du-tinh';

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
      { sku: 'Denio-DN0713-S-BLA', vendor: 'DeNio', brandSlug: 'denio', unitVnd: 700_000, giaNoiDiaVnd: 1_190_000, period: '2026-03' },
      { sku: 'Denio-DN0713-S-BLA', vendor: 'DeNio', brandSlug: 'denio', unitVnd: 714_000, giaNoiDiaVnd: 1_190_000, period: '2026-05' },
      { sku: 'Lamai-LM-25A042-XL-IVW-PDO', vendor: 'LaMai Atelier', brandSlug: 'lamai-atelier', unitVnd: 1_462_500, giaNoiDiaVnd: null, period: '2026-07' },
    ];
    const { uoc, conLai } = uocGiaVonTuLichSu([
      { sku: 'Denio-DN0713-S-BLA', vendor: 'DeNio' }, { sku: 'Lamai-LM-25A042-S-IVW-PDO', vendor: 'LaMai Atelier' },
      { sku: 'Cordia-X1-S', vendor: 'Cordia' }, { sku: 'Denio-DN0713-S-BLA', vendor: 'Poem' },
    ], lichSu);
    // giá nội địa + CK hiệu dụng của dòng nguồn (1 − 714.000/1.190.000 = 0,4); không có giá nội địa → CK 0, giá nội địa = giá thực.
    expect(uoc).toEqual([
      { sku: 'Denio-DN0713-S-BLA', giaVon: 714_000, nguon: 'lich_su_sku', theoSku: 'Denio-DN0713-S-BLA', period: '2026-05', brandSlug: 'denio', giaNoiDia: 1_190_000, ck: 0.4 },
      { sku: 'Lamai-LM-25A042-S-IVW-PDO', giaVon: 1_462_500, nguon: 'lich_su_ma_sp', theoSku: 'Lamai-LM-25A042-XL-IVW-PDO', period: '2026-07', brandSlug: 'lamai-atelier', giaNoiDia: 1_462_500, ck: 0 },
      { sku: 'Denio-DN0713-S-BLA', giaVon: 714_000, nguon: 'lich_su_sku', theoSku: 'Denio-DN0713-S-BLA', period: '2026-05', brandSlug: 'denio', giaNoiDia: 1_190_000, ck: 0.4 },
    ]);
    expect(conLai).toEqual([{ sku: 'Cordia-X1-S', vendor: 'Cordia' }]);
  });
});

describe('gia-du-tinh — CK theo tier THÁNG (CEO 09/09/2026: tier tính theo doanh số tháng đó)', () => {
  const ckKy = ckTheoBrandKy([
    { brandSlug: 'denio', period: '2026-01', ck: 0.4 }, { brandSlug: 'denio', period: '2026-01', ck: 0.4 }, { brandSlug: 'denio', period: '2026-01', ck: null },
    { brandSlug: 'denio', period: '2026-06', ck: 0.35 }, { brandSlug: 'denio', period: '2026-06', ck: 0.35 }, { brandSlug: 'denio', period: '2026-06', ck: 0.4 },
    { brandSlug: 'denio', period: '2026-07', ck: 0.35 },
    { brandSlug: 'denio', period: '2026-08', ck: 0.4 }, { brandSlug: 'denio', period: '2026-08', ck: 0.35 }, { brandSlug: 'denio', period: '2026-08', ck: 0.4 },
    { brandSlug: 'thesong', period: '2026-05', ck: 0.5 }, { brandSlug: 'thesong', period: '2026-06', ck: 0.55 },
    { brandSlug: 'poem', period: '2025-11', ck: 0.3 }, { brandSlug: 'poem', period: '2026-02', ck: 0.25 },
    { brandSlug: 'x', period: '2026-03', ck: 1 },
  ]);
  it('ckTheoBrandKy: mode theo brand × kỳ, bỏ ck ngoài (0,1)', () => {
    expect([...ckKy.get('denio')!.entries()]).toEqual([['2026-01', 0.4], ['2026-06', 0.35], ['2026-07', 0.35], ['2026-08', 0.4]]);
    expect(ckKy.get('thesong')!.get('2026-06')).toBe(0.55);
    expect(ckKy.has('x')).toBe(false);
  });
  it('laMucTierBrand: CK của SKU trùng một mức tier nào đó của brand → theo tier; 0 % hay mức lạ → CK riêng', () => {
    expect(laMucTierBrand(0.4, ckKy.get('denio'))).toBe(true);   // 40 % là tier T1–T5/T8 dù kỳ nguồn T6 đang 35 %
    expect(laMucTierBrand(0.35, ckKy.get('denio'))).toBe(true);
    expect(laMucTierBrand(0, ckKy.get('denio'))).toBe(false);    // belt 0 %
    expect(laMucTierBrand(0.25, ckKy.get('denio'))).toBe(false);
    expect(laMucTierBrand(0.4, undefined)).toBe(false);
  });
  it('cungMucCk: lệch < 0,5 điểm % coi là cùng mức', () => {
    expect(cungMucCk(0.4, 1 - 1_794_000 / 2_990_000)).toBe(true);
    expect(cungMucCk(0.375, 0.4)).toBe(false);
    expect(cungMucCk(0.4, undefined)).toBe(false);
  });
  it('dongGiaTheoKy: SKU theo tier → một dòng giá mỗi lần CK brand đổi, hiệu lực đầu tháng; tháng chưa kê dùng CK gần nhất trước đó', () => {
    const rows = dongGiaTheoKy([{ sku: 'Denio-DN0814-XS', brandSlug: 'denio', giaNoiDia: 2_990_000, ck: 0.4, theoTier: true }], ckKy);
    expect(rows).toEqual([
      { sku: 'Denio-DN0814-XS', effectiveFrom: '2026-01-01', giaVon: 1_794_000, ck: 0.4, kyCk: '2026-01' },
      { sku: 'Denio-DN0814-XS', effectiveFrom: '2026-06-01', giaVon: 1_943_500, ck: 0.35, kyCk: '2026-06' },
      { sku: 'Denio-DN0814-XS', effectiveFrom: '2026-08-01', giaVon: 1_794_000, ck: 0.4, kyCk: '2026-08' },
    ]);
  });
  it('dongGiaTheoKy: brand kê từ giữa năm → tháng trước đó dùng CK kỳ đầu tiên; có kỳ trước 2026 → dùng kỳ gần nhất ≤ tháng bắt đầu', () => {
    expect(dongGiaTheoKy([{ sku: 'TS-1', brandSlug: 'thesong', giaNoiDia: 1_000_000, ck: 0.55, theoTier: true }], ckKy)).toEqual([
      { sku: 'TS-1', effectiveFrom: '2026-01-01', giaVon: 500_000, ck: 0.5, kyCk: '2026-05' },
      { sku: 'TS-1', effectiveFrom: '2026-06-01', giaVon: 450_000, ck: 0.55, kyCk: '2026-06' },
    ]);
    expect(dongGiaTheoKy([{ sku: 'P-1', brandSlug: 'poem', giaNoiDia: 1_000_000, ck: 0.25, theoTier: true }], ckKy)).toEqual([
      { sku: 'P-1', effectiveFrom: '2026-01-01', giaVon: 700_000, ck: 0.3, kyCk: '2025-11' },
      { sku: 'P-1', effectiveFrom: '2026-02-01', giaVon: 750_000, ck: 0.25, kyCk: '2026-02' },
    ]);
  });
  it('dongGiaTheoKy: SKU có CK riêng (không theo tier) hoặc brand không có CK theo kỳ → một dòng phẳng với CK của chính nó', () => {
    expect(dongGiaTheoKy([
      { sku: 'Denio-PKDN0729-CRE', brandSlug: 'denio', giaNoiDia: 200_000, ck: 0, theoTier: false },
      { sku: 'Denio-DN0694+PK0694-XL-GRE', brandSlug: 'denio', giaNoiDia: 2_359_420, ck: 0.31, theoTier: false, giaVonPhang: 1_628_000 },
      { sku: 'New-1', brandSlug: 'new-brand', giaNoiDia: 1_000_000, ck: 0.25, theoTier: true },
      { sku: 'NoBrand-1', brandSlug: null, giaNoiDia: 1_000_000, ck: 0.3, theoTier: true },
    ], ckKy)).toEqual([
      { sku: 'Denio-PKDN0729-CRE', effectiveFrom: '2026-01-01', giaVon: 200_000, ck: 0, kyCk: null },
      { sku: 'Denio-DN0694+PK0694-XL-GRE', effectiveFrom: '2026-01-01', giaVon: 1_628_000, ck: 0.31, kyCk: null },
      { sku: 'New-1', effectiveFrom: '2026-01-01', giaVon: 750_000, ck: 0.25, kyCk: null },
      { sku: 'NoBrand-1', effectiveFrom: '2026-01-01', giaVon: 700_000, ck: 0.3, kyCk: null },
    ]);
  });
});

describe('gia-du-tinh — nguồn kèm kỳ CK', () => {
  it('nguonTheoKy ↔ kyCkTuNguon; ghi chú tạm khi đơn ở tháng sau kỳ CK', () => {
    expect(nguonTheoKy('uoc:lich_su_bang_ke', '2026-06')).toBe('uoc:lich_su_bang_ke@ck=2026-06');
    expect(nguonTheoKy('uoc:lich_su_bang_ke', null)).toBe('uoc:lich_su_bang_ke');
    expect(kyCkTuNguon('uoc:mmp_vnd_x_ck@ck=2026-08')).toBe('2026-08');
    expect(kyCkTuNguon('shopify')).toBeNull();
    expect(ghiChuGiaDuTinh('uoc:lich_su_bang_ke@ck=2026-07', '2026-09')).toBe('CK tier kỳ 2026-07 — tạm, chưa có bảng kê tháng 2026-09');
    expect(ghiChuGiaDuTinh('uoc:lich_su_bang_ke@ck=2026-07', '2026-07')).toBe('CK tier kỳ 2026-07');
    expect(ghiChuGiaDuTinh('uoc:lich_su_bang_ke', '2026-07')).toBeNull();
  });
});
