import { describe, it, expect } from 'vitest';
import { chiTietCuoc, dichGhiChu } from './chi-tiet-cuoc';
import type { QuoteBreakdown } from '../engine/quote';

/** Số thật của đơn đi Skamokawa WA 98647, 2kg, FedEx (10/09/2026). */
const b: QuoteBreakdown = {
  actualWeightKg: 2, dimWeightKg: 0, chargeableWeightKg: 2,
  base: 922_444, fuel: 543_602, fuelPercent: 46, peak: 0,
  addons: 92_700, addonReference: 0, addonExcludedForCountry: false,
  remote: 82_200, residential: 84_400, perKg: 0, demand: 0,
  countryFixed: 68_300, countryFixedReference: 0, perStep: 0,
  vatPercent: 8, vat: 143_492, discountPercent: 0, discount: 0,
  packaging: 130_000, markup: 103_357,
  subtotalBeforeMarkup: 1_937_138, carrierCost: 1_937_138, carrierCostDisplay: 74.51,
  finalCost: 2_170_495, finalDisplay: 83.48,
};

describe('chiTietCuoc', () => {
  it('tổng các dòng = cước trả carrier, KHÔNG gồm đóng gói và markup của shop', () => {
    const r = chiTietCuoc(b);
    expect(r.khop).toBe(true);
    expect(Math.round(r.tong)).toBe(1_937_138);
    expect(r.dong.map((d) => d.ma)).not.toContain('packaging');
    expect(r.dong.map((d) => d.ma)).not.toContain('markup');
  });

  it('bỏ dòng bằng 0, giữ đúng thứ tự đọc và gắn phần trăm', () => {
    const r = chiTietCuoc(b);
    expect(r.dong.map((d) => d.ma)).toEqual(['base', 'remote', 'residential', 'countryFixed', 'addons', 'fuel', 'vat']);
    expect(r.dong.find((d) => d.ma === 'fuel')?.ghiChu).toBe('46%');
    expect(r.dong.find((d) => d.ma === 'vat')?.ghiChu).toBe('8%');
  });

  it('chiết khấu hợp đồng hiện thành số ÂM và vẫn khớp tổng', () => {
    const r = chiTietCuoc({ ...b, discount: 100_000, discountPercent: 10, carrierCost: 1_837_138 });
    expect(r.dong.find((d) => d.ma === 'discount')).toMatchObject({ giaTri: -100_000, ghiChu: '10%' });
    expect(r.khop).toBe(true);
  });

  it('hệ số quy đổi nhân đều mọi dòng (account tính tiền USD)', () => {
    const r = chiTietCuoc(b, 26_000);
    expect(r.dong[0].giaTri).toBe(922_444 * 26_000);
    expect(r.khop).toBe(true);
  });

  it('engine đổi cách tính mà bảng chưa cập nhật → khop = false, không im lặng hiện số sai', () => {
    expect(chiTietCuoc({ ...b, carrierCost: 9_999_999 }).khop).toBe(false);
  });

  it('phụ phí chỉ-khi-bị-bill nằm ở mục tham chiếu, không cộng vào tổng', () => {
    const r = chiTietCuoc({ ...b, addonReference: 1_973_060 });
    expect(Math.round(r.tong)).toBe(1_937_138);
    expect(r.thamChieu[0]).toMatchObject({ ma: 'addonReference', giaTri: 1_973_060 });
  });

  it('cân: báo rõ khi dùng cân quy đổi theo kích thước', () => {
    expect(chiTietCuoc(b).canNang).toMatchObject({ thuc: 2, tinhCuoc: 2, dungQuyDoi: false });
    expect(chiTietCuoc({ ...b, dimWeightKg: 4.5, chargeableWeightKg: 4.5 }).canNang).toMatchObject({ quyDoi: 4.5, dungQuyDoi: true });
  });
});

describe('dichGhiChu', () => {
  it('dịch các ghi chú engine hay gặp', () => {
    expect(dichGhiChu('remote_match:postcode (Tier A)')).toBe('Địa chỉ nằm trong vùng sâu, khớp theo mã bưu chính (Tier A)');
    expect(dichGhiChu('remote_match:city')).toBe('Địa chỉ nằm trong vùng sâu, khớp theo tên thành phố');
    expect(dichGhiChu('dim_weight (4.5 kg)')).toBe('Cân quy đổi theo kích thước lớn hơn cân thực: 4.5 kg');
    expect(dichGhiChu('chargeable_rounded (4.3 → 4.5 kg)')).toBe('Cân tính cước làm tròn lên: 4.3 → 4.5 kg');
    expect(dichGhiChu('pak')).toBe('Tính theo giá phong bì/Pak');
  });
  it('ghi chú lạ giữ nguyên, không nuốt thông tin', () => {
    expect(dichGhiChu('điều gì đó mới')).toBe('điều gì đó mới');
  });
});
