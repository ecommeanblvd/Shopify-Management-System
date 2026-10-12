import { describe, it, expect } from 'vitest';
import { docPhanHoiShop, chonMucReNhat, tenDichVuUps, thanRequestShop } from './rate';

/** Hình dạng THẬT của phản hồi `Shop` (trích từ lượt gọi ngày 12/10/2026, US 2kg). */
const SHOP_THAT = {
  RateResponse: {
    Response: { ResponseStatus: { Code: '1', Description: 'Success' } },
    RatedShipment: [
      {
        Service: { Code: '65' }, Zone: '5',
        BillingWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: '2.0' },
        BaseServiceCharge: { CurrencyCode: 'VND', MonetaryValue: '4075135.00' },
        TotalCharges: { CurrencyCode: 'VND', MonetaryValue: '6395290.00' },
        NegotiatedRateCharges: {
          BaseServiceCharge: { CurrencyCode: 'VND', MonetaryValue: '827200.00' },
          TotalCharge: { CurrencyCode: 'VND', MonetaryValue: '1442195.00' },
          ItemizedCharges: [
            { Code: '573', CurrencyCode: 'VND', MonetaryValue: '58750.00' },
            { Code: '375', CurrencyCode: 'VND', MonetaryValue: '476345.00' },
            { Code: '434', CurrencyCode: 'VND', MonetaryValue: '79900.00', SubType: 'Surge_Fee_Commercial' },
            { Code: '270', CurrencyCode: 'VND', MonetaryValue: '0.00' },
          ],
        },
      },
      {
        Service: { Code: '08' }, Zone: '5',
        BillingWeight: { Weight: '2.0' },
        NegotiatedRateCharges: {
          BaseServiceCharge: { MonetaryValue: '788190.00' },
          TotalCharge: { CurrencyCode: 'VND', MonetaryValue: '1382505.00' },
          ItemizedCharges: { Code: '375', MonetaryValue: '455764.00' },
        },
      },
    ],
  },
};

describe('tenDichVuUps', () => {
  it('đổi mã thành tên đọc được', () => {
    expect(tenDichVuUps('08')).toBe('Worldwide Expedited');
    expect(tenDichVuUps('65')).toBe('Worldwide Express Saver');
  });
  it('mã lạ giữ nguyên số, không bịa tên', () => {
    expect(tenDichVuUps('99')).toBe('Dịch vụ 99');
  });
});

describe('docPhanHoiShop', () => {
  it('đọc mọi mức dịch vụ theo GIÁ HỢP ĐỒNG', () => {
    const ds = docPhanHoiShop(SHOP_THAT);
    expect(ds.map((d) => d.maDichVu)).toEqual(['65', '08']);
    expect(ds[0]).toMatchObject({ base: 827200, tong: 1442195, zone: '5', canTinhCuocKg: 2, tienTe: 'VND' });
  });
  it('bỏ khoản 0đ, giữ SubType của surge', () => {
    const d = docPhanHoiShop(SHOP_THAT)[0];
    expect(d.khoan.map((k) => k.ma)).toEqual(['573', '375', '434']);
    expect(d.khoan.find((k) => k.ma === '434')?.phu).toBe('Surge_Fee_Commercial');
  });
  /* `ItemizedCharges` là OBJECT khi chỉ có một khoản — bản đầu chỉ nhận mảng thì mọi con số
   * ra 0 mà không báo lỗi gì. */
  it('nhận ItemizedCharges dạng object lẫn mảng', () => {
    expect(docPhanHoiShop(SHOP_THAT)[1].khoan).toEqual([{ ma: '375', tien: 455764 }]);
  });
  it('RatedShipment là object (chỉ một mức) vẫn đọc được', () => {
    const mot = { RateResponse: { RatedShipment: SHOP_THAT.RateResponse.RatedShipment[0] } };
    expect(docPhanHoiShop(mot)).toHaveLength(1);
  });
  /* Giá niêm yết cao gấp ~4 lần giá hợp đồng. Hiện nó lên bảng so cước là đẩy UPS xuống cuối
   * một cách SAI — thiếu giá hợp đồng thì bỏ dòng, để chỗ gọi báo "không báo giá được". */
  it('KHÔNG rơi về giá niêm yết khi thiếu giá hợp đồng', () => {
    const khongHopDong = { RateResponse: { RatedShipment: [{
      Service: { Code: '65' }, TotalCharges: { MonetaryValue: '6395290.00' },
      BaseServiceCharge: { MonetaryValue: '4075135.00' },
    }] } };
    expect(docPhanHoiShop(khongHopDong)).toEqual([]);
  });
  it('phản hồi rỗng / rác → mảng rỗng, không ném', () => {
    expect(docPhanHoiShop(null)).toEqual([]);
    expect(docPhanHoiShop({})).toEqual([]);
    expect(docPhanHoiShop({ RateResponse: { RatedShipment: [] } })).toEqual([]);
  });
});

describe('chonMucReNhat', () => {
  it('lấy mức có tổng hợp đồng nhỏ nhất', () => {
    expect(chonMucReNhat(docPhanHoiShop(SHOP_THAT))?.maDichVu).toBe('08');
  });
  it('mảng rỗng → null', () => {
    expect(chonMucReNhat([])).toBeNull();
  });
});

describe('thanRequestShop', () => {
  const vao = { soTaiKhoan: '2050VD', nuocDen: 'US', maBuuChinh: '90266', thanhPho: 'LOS ANGELES', canKg: 2 };
  const lo = (v: Record<string, unknown>) =>
    (v.RateRequest as { Shipment: Record<string, unknown> }).Shipment;

  it('đòi giá hợp đồng và dùng RequestOption Shop', () => {
    const r = thanRequestShop(vao);
    expect((r.RateRequest as { Request: { RequestOption: string } }).Request.RequestOption).toBe('Shop');
    expect(lo(r).ShipmentRatingOptions).toEqual({ NegotiatedRatesIndicator: 'Y' });
  });
  /* Ký nhận khai ở mức Package thì UPS từ chối 111211 (thử cả DCISType 1/2/3) — phải ở mức
   * Shipment. Mặc định CÓ vì hoá đơn tháng 9 thu 37/37 lô. */
  it('ký nhận khai ở mức SHIPMENT, mặc định có', () => {
    expect(lo(thanRequestShop(vao)).ShipmentServiceOptions)
      .toEqual({ DeliveryConfirmation: { DCISType: '1' } });
  });
  it('brand không chọn ký nhận → bỏ hẳn khối đó', () => {
    expect(lo(thanRequestShop({ ...vao, kyNhan: false })).ShipmentServiceOptions).toBeUndefined();
  });
  it('nhà dân → gắn cờ để UPS cộng phụ phí giao nhà dân', () => {
    const nhan = (lo(thanRequestShop({ ...vao, nhaDan: true })).ShipTo as { Address: Record<string, unknown> }).Address;
    expect(nhan.ResidentialAddressIndicator).toBe('Y');
  });
  it('có kích thước thì gửi kèm (để UPS tự tính cân quy đổi)', () => {
    const kien = (lo(thanRequestShop({ ...vao, kichThuocCm: { dai: 40, rong: 30, cao: 20 } })).Package as Array<Record<string, unknown>>)[0];
    expect(kien.Dimensions).toMatchObject({ Length: '40', Width: '30', Height: '20' });
  });
  it('không kích thước thì KHÔNG gửi khối Dimensions rỗng', () => {
    const kien = (lo(thanRequestShop(vao)).Package as Array<Record<string, unknown>>)[0];
    expect(kien.Dimensions).toBeUndefined();
  });
});
