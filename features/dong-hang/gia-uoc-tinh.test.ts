import { describe, it, expect } from 'vitest';
import { tuEngine, tuKhoanUps, tuFedexQuote, vatSuyRa, type GiaUocTinh } from './gia-uoc-tinh';
import type { QuoteBreakdown } from '@/features/carrier-rates/engine/quote';

describe('tuEngine', () => {
  it('map đúng từng khoản và đánh dấu nguồn bảng giá', () => {
    const g = tuEngine({ base: 100, fuel: 20, remote: 5, demand: 3, residential: 7,
      addonReference: 9, countryFixed: 11, /* …phần còn lại của QuoteBreakdown */ } as QuoteBreakdown, 155);
    expect(g).toMatchObject({ nguon: 'bang-gia', base: 100, fuel: 20, remote: 5, demand: 3,
      residential: 7, signature: 9, importHandling: 11, total: 155 });
  });
});

describe('tuKhoanUps', () => {
  it('cộng dồn khoản trùng mã', () => {
    expect(tuKhoanUps([{ ma: 'FUEL SURCHARGE', tien: 10 }, { ma: 'FUEL SURCHARGE', tien: 5 }], 15).fuel).toBe(15);
  });
  /* Review Focus #3: UPS KHÔNG trả VAT thành khoản riêng. Phải là null, không phải 0. */
  it('UPS không có VAT → vat là null, KHÔNG phải 0', () => {
    expect(tuKhoanUps([{ ma: 'FUEL SURCHARGE', tien: 10 }], 10).vat).toBeNull();
  });
  it('khoản UPS không biết xếp đâu thì bỏ qua, không làm hỏng các khoản khác', () => {
    expect(tuKhoanUps([{ ma: 'KHOAN_LA', tien: 99 }, { ma: 'FUEL SURCHARGE', tien: 10 }], 109).fuel).toBe(10);
  });
});

describe('tuFedexQuote', () => {
  /* `fedex_rate_quotes` đã giữ sẵn từng khoản (xem FedexQuoteSnap); chỉ đổi tên trường,
   * KHÔNG tính lại gì — tính lại là đẻ ra con số thứ hai cho cùng một kiện. */
  it('map thẳng từ dòng quote đã lưu, nguồn là fedex-api', () => {
    const g = tuFedexQuote({ totalNetCharge: 500, fuel: 50, fuelPercent: 47.75, remote: 0,
      demand: 10, residential: 0, signature: 20, countryFixed: 30, vat: 40, discount: -100,
      service: 'IP', rateZone: 'H' });
    expect(g).toMatchObject({ nguon: 'fedex-api', fuel: 50, demand: 10, signature: 20,
      importHandling: 30, vat: 40, total: 500 });
  });
});

describe('vatSuyRa', () => {
  /* Đo 37/37 dòng hoá đơn UPS 100000813108: VAT = 7,97–8,00% của gốc chịu thuế;
   * gốc = mọi khoản dịch vụ, TRỪ chính VAT và TRỪ thuế nhập khẩu. */
  it('8% trên tổng các khoản dịch vụ', () => {
    expect(vatSuyRa({ base: 1000, fuel: 100, remote: null, demand: null, signature: null,
      residential: null, importHandling: 400, vat: null, total: null, nguon: 'ups-api' })).toBe(120);
  });
  it('đã có vat thì giữ nguyên, không tính lại', () => {
    expect(vatSuyRa({ vat: 77, base: 1000 } as GiaUocTinh)).toBe(77);
  });
  it('không có khoản nào → null, không ra 0', () => {
    expect(vatSuyRa({ vat: null, base: null, fuel: null } as GiaUocTinh)).toBeNull();
  });
});
