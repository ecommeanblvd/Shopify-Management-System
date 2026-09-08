import { describe, it, expect } from 'vitest';
import { tinhBaoCao } from './bao-cao-logic';
const rates = [{ from: 'USD', to: 'VND', period: '2026-07', rate: 26000 }];
describe('tinhBaoCao', () => {
  it('đổi USD→VND theo tháng, trừ ship và cogs, offline cột riêng, độ phủ', () => {
    const r = tinhBaoCao({
      thang: ['2026-08'],
      doanhThu: [{ period: '2026-08', storeId: 's1', currency: 'USD', doanhThuThuan: 1000, phiShip: 100, soDon: 10, soLine: 20, soLineCoCogs: 15, doanhThuLineCoCogs: 800, doanhThuLineTong: 1000 }],
      cogs: [{ period: '2026-08', storeId: 's1', brandSlug: 'denio', amount: 12_000_000, currency: 'VND', thuocThangTruoc: 2_000_000 }],
      offline: [{ period: '2026-08', brandSlug: 'denio', amount: 5_000_000 }],
      rates,
    });
    expect(r).toEqual([{ period: '2026-08', doanhThuThuan: 26_000_000, phiShip: 2_600_000, cogs: 12_000_000, laiGop: 11_400_000, offline: 5_000_000, phuLine: 0.75, phuDoanhThu: 0.8, thuocThangTruoc: 2_000_000, tiGiaTam: true, thieuTiGia: false }]);
  });
  it('không có tỉ giá nào trước đó → thiếu tỉ giá, doanh thu 0, không nổ', () => {
    const r = tinhBaoCao({ thang: ['2026-05'], doanhThu: [{ period: '2026-05', storeId: 's1', currency: 'USD', doanhThuThuan: 10, phiShip: 1, soDon: 1, soLine: 1, soLineCoCogs: 0, doanhThuLineCoCogs: 0, doanhThuLineTong: 10 }], cogs: [], offline: [], rates });
    expect(r[0]).toMatchObject({ thieuTiGia: true, doanhThuThuan: 0, phiShip: 0, cogs: 0, phuLine: 0 });
  });
  it('tháng không có gì → dòng 0', () => {
    expect(tinhBaoCao({ thang: ['2026-01'], doanhThu: [], cogs: [], offline: [], rates })[0]).toMatchObject({ doanhThuThuan: 0, cogs: 0, laiGop: 0, phuLine: 0, phuDoanhThu: 0 });
  });
  it('dòng doanh thu VND không đổi tiền', () => {
    const r = tinhBaoCao({ thang: ['2026-08'], doanhThu: [{ period: '2026-08', storeId: 's2', currency: 'VND', doanhThuThuan: 500, phiShip: 0, soDon: 1, soLine: 1, soLineCoCogs: 1, doanhThuLineCoCogs: 500, doanhThuLineTong: 500 }], cogs: [], offline: [], rates });
    expect(r[0]).toMatchObject({ doanhThuThuan: 500, tiGiaTam: false, thieuTiGia: false, phuLine: 1 });
  });
  it('thuocThangTruoc đổi tiền theo ĐÚNG tỉ giá đã tra cho cogs (USD→VND), không cộng thẳng số USD vào VND', () => {
    const r = tinhBaoCao({
      thang: ['2026-08'],
      doanhThu: [],
      cogs: [{ period: '2026-08', storeId: 's1', brandSlug: 'tinh', amount: 100, currency: 'USD', thuocThangTruoc: 40 }],
      offline: [],
      rates: [{ from: 'USD', to: 'VND', period: '2026-08', rate: 26_000 }],
    });
    expect(r[0]).toMatchObject({ cogs: 2_600_000, thuocThangTruoc: 1_040_000, tiGiaTam: false, thieuTiGia: false });
  });

  it('phuDoanhThu dùng mẫu số doanhThuLineTong (mức LINE), không phải doanhThuThuan (mức ĐƠN, gồm cả shipping) — hai giá trị khác nhau', () => {
    // doanhThuThuan (order-level, có cộng thêm phí ship thu của khách vào giá
    // trị đơn theo cách tính netGmv) = 1200, nhưng tổng doanh thu LINE thực tế
    // (unit_price*qty - discount_alloc, không gồm ship) chỉ 900 — tỉ lệ phủ
    // phải tính trên 900, không phải 1200.
    const r = tinhBaoCao({
      thang: ['2026-08'],
      doanhThu: [{ period: '2026-08', storeId: 's3', currency: 'VND', doanhThuThuan: 1200, phiShip: 0, soDon: 5, soLine: 9, soLineCoCogs: 9, doanhThuLineCoCogs: 900, doanhThuLineTong: 900 }],
      cogs: [], offline: [], rates,
    });
    expect(r[0]).toMatchObject({ doanhThuThuan: 1200, phuDoanhThu: 1 });
  });
});
