import { describe, it, expect } from 'vitest';
import { tuEngine, tuKhoanUps, tuFedexQuote } from './gia-uoc-tinh';
import type { QuoteBreakdown } from '@/features/carrier-rates/engine/quote';

describe('tuEngine', () => {
  const b = { base: 100, fuel: 20, remote: 5, demand: 3, residential: 7, vat: 13,
    addonReference: 9, countryFixed: 11, countryFixedReference: 77,
    /* …phần còn lại của QuoteBreakdown */ } as QuoteBreakdown;

  it('account tính bằng VND (hệ số 1) thì map thẳng từng khoản', () => {
    expect(tuEngine(b, 155, 1)).toMatchObject({ nguon: 'bang-gia', base: 100, fuel: 20,
      remote: 5, demand: 3, residential: 7, importHandling: 11, vat: 13, total: 155 });
  });

  /* C1: `QuoteBreakdown` ở đơn vị cost currency của account (Aramex HN = USD) nhưng MỌI cột
   * chi phí Lark là VND. Không quy đổi là ghi `base = 50` (USD) cạnh ô Tổng 1.877.160 (VND). */
  it('account tính bằng USD thì mọi khoản phải quy về VND cùng hệ số với ô Tổng', () => {
    const g = tuEngine(b, 2_600_000, 26_000);
    expect(g.base).toBe(100 * 26_000);
    expect(g.fuel).toBe(20 * 26_000);
    expect(g.vat).toBe(13 * 26_000);
  });

  /* Không biết quy đổi thế nào thì KHÔNG BIẾT HẾT — kể cả ô Tổng, vì `vndCost` lúc đó cũng
   * chỉ là phỏng đoán best-effort của bảng so cước, không đủ để ghi vào ô tiền VND. */
  it('không biết hệ số quy đổi → mọi khoản và cả tổng đều null, không ghi gì', () => {
    const g = tuEngine(b, 155, null);
    expect([g.base, g.fuel, g.remote, g.demand, g.residential, g.importHandling, g.vat, g.total])
      .toEqual([null, null, null, null, null, null, null, null]);
  });

  /* C1(b): `addonReference` là TỔNG MỌI dòng addon_fixed when_billed — với Aramex là 552,5 USD
   * phí theo ca (pallet/quá cân/ngoại cỡ/DDP/sai địa chỉ) chưa ai thu. Engine không tách được
   * riêng khoản ký nhận ⇒ phải trả null, không được trả một con số gộp. */
  it('ký nhận là null, KHÔNG lấy addonReference gộp', () => {
    expect(tuEngine(b, 155, 1).signature).toBeNull();
  });

  /* C2 (kèm theo): `countryFixedReference` cũng là giá THAM CHIẾU chưa thu — không rơi về nó. */
  it('phí xử lý hàng nhập chỉ lấy countryFixed, không rơi về countryFixedReference', () => {
    const g = tuEngine({ ...b, countryFixed: 0 } as QuoteBreakdown, 155, 1);
    expect(g.importHandling).toBe(0);
  });
});

describe('tuKhoanUps', () => {
  it('cộng dồn khoản trùng mã', () => {
    // '375' = Nhiên liệu (mã số thật của Rating API, xem TEN_KHOAN ở lib/ups/rate.ts).
    expect(tuKhoanUps([{ ma: '375', tien: 10 }, { ma: '375', tien: 5 }], 15, null).fuel).toBe(15);
  });
  /* Review Focus #3: UPS KHÔNG trả VAT thành khoản riêng. Phải là null, không phải 0. */
  it('UPS không có VAT → vat là null, KHÔNG phải 0', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 10, null).vat).toBeNull();
  });
  it('khoản UPS không biết xếp đâu thì bỏ qua, không làm hỏng các khoản khác', () => {
    expect(tuKhoanUps([{ ma: 'KHOAN_LA', tien: 99 }, { ma: '375', tien: 10 }], 109, null).fuel).toBe(10);
  });
  /* '190' (Phụ phí xử lý chung) là mã THẬT của UPS nhưng không có nhóm tương ứng trong
   * GiaUocTinh — phải nêu ra ở maLa, không được biến mất lặng lẽ như tiền không ai biết. */
  it('mã thật nhưng chưa có nhóm (190) đi vào maLa, không làm hỏng khoản khác', () => {
    const g = tuKhoanUps([{ ma: '190', tien: 50 }, { ma: '375', tien: 10 }], 60, null);
    expect(g.maLa).toEqual(['190']);
    expect(g.fuel).toBe(10);
  });
  /* I1: `base` của UPS nằm ở một field RIÊNG (`DongBaoGiaUps.base`), không trong danh sách
   * khoản. Bỏ rơi nó là ô "Mức giá cơ sở" của UPS không bao giờ được điền. */
  it('base do caller truyền vào (UPS trả ở field riêng), không bị bỏ rơi', () => {
    expect(tuKhoanUps([{ ma: '375', tien: 10 }], 1_100, 1_000).base).toBe(1_000);
  });
});

describe('tuFedexQuote', () => {
  /* `fedex_rate_quotes` đã giữ sẵn từng khoản (xem FedexQuoteSnap); chỉ đổi tên trường,
   * KHÔNG tính lại gì — tính lại là đẻ ra con số thứ hai cho cùng một kiện. */
  it('map thẳng từ dòng quote đã lưu, nguồn là fedex-api', () => {
    const g = tuFedexQuote({ totalNetCharge: 500, fuel: 50, fuelPercent: 47.75, remote: 0,
      demand: 10, residential: 0, signature: 20, countryFixed: 30, vat: 40, discount: -100,
      service: 'IP', rateZone: 'H' }, 350);
    expect(g).toMatchObject({ nguon: 'fedex-api', fuel: 50, demand: 10, signature: 20,
      importHandling: 30, vat: 40, total: 500 });
  });
  /* I7: `fedex_rate_quotes.base_charge` ĐÃ lưu sẵn — để base null là 2.809/4.276 kiện (hãng
   * lớn nhất) vẫn phải gõ tay đúng ô quan trọng nhất. Lấy số đã lưu, KHÔNG tính lại. */
  it('base lấy từ cột base_charge đã lưu, không tính lại', () => {
    expect(tuFedexQuote({ totalNetCharge: 500, fuel: 50, fuelPercent: null, remote: null,
      demand: null, residential: null, signature: null, countryFixed: null, vat: 40,
      discount: null, service: 'IP', rateZone: null }, 350).base).toBe(350);
  });
});
