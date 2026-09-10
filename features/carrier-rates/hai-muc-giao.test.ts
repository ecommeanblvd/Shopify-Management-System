import { describe, it, expect } from 'vitest';
import { giaExpress, taoHaiMucRate, moTaMuc, ngayGiaoMuc, loTenHang, TEN_MUC, PHU_PHI_EXPRESS_PHAN_TRAM } from './hai-muc-giao';

describe('giaExpress', () => {
  it('cộng phụ phí % rồi làm tròn LÊN theo bước 0,5', () => {
    expect(PHU_PHI_EXPRESS_PHAN_TRAM).toBe(20);
    expect(giaExpress(51.23)).toBe(61.5); // 61.476 → 61.5
    expect(giaExpress(50)).toBe(60);      // 60 đúng bước → giữ
    expect(giaExpress(42.1)).toBe(51);    // 50.52 → 51
  });
  it('LUÔN lớn hơn Standard, kể cả giá 0 hay phụ phí 0 %', () => {
    for (const g of [0, 0.01, 0.3, 1, 12.34, 99.99, 377, 1234.56]) expect(giaExpress(g)).toBeGreaterThan(g);
    expect(giaExpress(50, 0)).toBe(50.5);
  });
});

describe('taoHaiMucRate', () => {
  const rates = taoHaiMucRate({ giaStandard: 51.23, currency: 'USD', nuoc: 'US' });
  it('đúng HAI rate, thứ tự Standard rồi Express, tên chuẩn, mã dịch vụ ổn định', () => {
    expect(rates.map((r) => r.service_name)).toEqual([TEN_MUC.standard, TEN_MUC.express]);
    expect(rates.map((r) => r.service_code)).toEqual(['standard', 'express']);
    expect(rates.every((r) => r.currency === 'USD')).toBe(true);
  });
  it('total_price là cents dạng chuỗi và Standard < Express', () => {
    expect(rates[0].total_price).toBe('5123');
    expect(rates[1].total_price).toBe('6150');
    expect(Number(rates[0].total_price)).toBeLessThan(Number(rates[1].total_price));
  });
  it('KHÔNG lộ tên hãng ở tên hay mô tả', () => {
    for (const r of rates) {
      expect(loTenHang(r.service_name)).toBe(false);
      expect(loTenHang(r.description ?? '')).toBe(false);
    }
  });
  it('Express hứa đúng mức SOP của nước, Standard là khoảng chậm hơn 2–5 ngày', () => {
    expect(moTaMuc('express', 'US')).toBe('Priority handling, dispatched first · delivery in about 5 days');
    expect(moTaMuc('standard', 'US')).toBe('Standard handling · delivery in about 7–10 days');
    expect(moTaMuc('express', 'HK')).toBe('Priority handling, dispatched first · delivery in about 3 days');
    expect(moTaMuc('standard', 'HK')).toBe('Standard handling · delivery in about 5–8 days');
    expect(moTaMuc('standard', 'ZZ')).toBe('Standard handling · delivery in about 12–15 days');
  });

  it('hai mô tả KHÔNG được giống nhau ở bất kỳ nước nào — giống thì khách không có lý do chọn Express', () => {
    for (const cc of ['US', 'HK', 'SA', 'DE', 'JP', 'AU', 'ZZ']) {
      expect(moTaMuc('standard', cc)).not.toBe(moTaMuc('express', cc));
      const st = ngayGiaoMuc('standard', cc); const ex = ngayGiaoMuc('express', cc);
      expect(st.tu).toBeGreaterThan(ex.den);   // ngày sớm nhất của Standard vẫn muộn hơn ngày muộn nhất của Express
    }
  });
});

describe('loTenHang', () => {
  it('bắt FedEx/DHL/Aramex/UPS/SF, không bắt chữ thường vô hại', () => {
    expect(loTenHang('FedEx International Priority')).toBe(true);
    expect(loTenHang('DHL Express')).toBe(true);
    expect(loTenHang('via UPS')).toBe(true);
    expect(loTenHang('SF-Express')).toBe(true);
    expect(loTenHang('Standard Shipping · about 5 days in transit')).toBe(false);
    expect(loTenHang('groups')).toBe(false); // "ups" nằm trong từ khác không tính
  });
});
