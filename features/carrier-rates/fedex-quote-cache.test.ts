import { describe, expect, it } from 'vitest';
import {
  dauVaoTuInput, KHOA_DAU_VAO_QUOTE, PHIEN_BAN_DAU_VAO, pickQuote, xetCacheQuote,
  type DauVaoQuote, type QuoteShipmentInput,
} from './fedex-quote-cache';
import type { RateQuoteResult } from '@/lib/fedex/rate';

const q = (over: Partial<RateQuoteResult>): RateQuoteResult => ({
  serviceType: 'X', rateType: 'ACCOUNT', currency: 'VND', totalNetCharge: 0,
  baseCharge: null, totalSurcharges: null, surcharges: [],
  components: { fuel: 0, residential: 0, remote: 0, demand: 0, signature: 0, countryFixed: 0, other: 0 },
  fuelPercent: null, vat: 0, discount: 0, billingWeightKg: null, rateZone: null, ...over,
});

describe('pickQuote', () => {
  it('ưu tiên ACCOUNT đúng dịch vụ mặc định', () => {
    const r = pickQuote([
      q({ serviceType: 'FEDEX_INTERNATIONAL_PRIORITY', rateType: 'LIST' }),
      q({ serviceType: 'INTERNATIONAL_ECONOMY', rateType: 'ACCOUNT' }),
      q({ serviceType: 'FEDEX_INTERNATIONAL_PRIORITY', rateType: 'ACCOUNT' }),
    ], 'FEDEX_INTERNATIONAL_PRIORITY');
    expect(r?.serviceType).toBe('FEDEX_INTERNATIONAL_PRIORITY');
    expect(r?.rateType).toBe('ACCOUNT');
  });
  it('thiếu dịch vụ mặc định → ACCOUNT đầu tiên', () => {
    const r = pickQuote([q({ serviceType: 'INTERNATIONAL_ECONOMY', rateType: 'ACCOUNT' })], 'FEDEX_INTERNATIONAL_PRIORITY');
    expect(r?.serviceType).toBe('INTERNATIONAL_ECONOMY');
  });
  it('không có ACCOUNT → null', () => {
    expect(pickQuote([q({ rateType: 'LIST' })], 'X')).toBeNull();
  });
});

const dauVao: DauVaoQuote = {
  v: PHIEN_BAN_DAU_VAO,
  weightKg: 0.7,
  dims: { length: 40, width: 31, height: 2 },
  shipDate: '2026-10-14',
  signatureOptIn: true,
  recipientResidential: true,
  packagingType: 'FEDEX_PAK',
  serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
  city: 'BUKAYRIYAH',
};
/** Dòng `raw` như CSDL thật giữ: phản hồi hãng + dấu đầu vào cạnh nó. */
const raw = (d: unknown): unknown => ({ output: { rateReplyDetails: [] }, [KHOA_DAU_VAO_QUOTE]: d });

describe('dauVaoTuInput', () => {
  const input: QuoteShipmentInput = {
    shipmentId: 'S1', originHub: 'HN', country: 'US', postcode: '98133',
    weightKg: 0.7, dims: { length: 40, width: 31, height: 2 },
    shipDate: new Date('2026-10-14T00:00:00Z'),
    signatureOptIn: true, recipientResidential: true,
    packagingType: 'FEDEX_PAK', serviceType: 'FEDEX_INTERNATIONAL_PRIORITY', city: 'BUKAYRIYAH',
  };
  it('lấy đúng ngày YYYY-MM-DD như lượt gọi Rate API', () => {
    expect(dauVaoTuInput(input).shipDate).toBe('2026-10-14');
  });
  /* Cờ `undefined` và `false` phải ra CÙNG một dấu: `quoteRate` đối xử với chúng như nhau
   * (không gửi special service), nên coi chúng khác nhau là quote lại một cách vô cớ. */
  it('cờ thiếu quy về false, không để undefined', () => {
    const d = dauVaoTuInput({ ...input, signatureOptIn: undefined, recipientResidential: undefined });
    expect(d.signatureOptIn).toBe(false);
    expect(d.recipientResidential).toBe(false);
    expect(xetCacheQuote(raw(d), dauVaoTuInput({ ...input, signatureOptIn: false, recipientResidential: false })))
      .toBe('con-dung');
  });
  it('thiếu dims → null, không phải undefined (để so được với dòng đã lưu)', () => {
    expect(dauVaoTuInput({ ...input, dims: undefined }).dims).toBeNull();
  });
});

describe('xetCacheQuote', () => {
  it('đầu vào y nguyên → còn dùng được, không gọi hãng lần nữa', () => {
    expect(xetCacheQuote(raw(dauVao), dauVao)).toBe('con-dung');
  });

  /* Chính ca CEO báo 15/10/2026: chạy phân tích lúc cân chưa chốt thì dòng cache đóng băng giá
   * của cân cũ, cân sửa sau không bao giờ vào giá. */
  it('cân đổi → phải quote lại', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, weightKg: 2 })).toBe('lech-dau-vao');
  });
  it('kích thước đổi → phải quote lại', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, dims: { length: 40, width: 31, height: 9 } }))
      .toBe('lech-dau-vao');
  });
  /* Thiếu CHIỀU CAO là mất cả khối dims (luật `lay-gia-uoc-tinh.ts`) ⇒ FedEx tính theo cân
   * thực thay vì max(thực, thể tích) — đổi hẳn cách tính, không được dùng lại dòng cũ. */
  it('có dims ↔ không dims → phải quote lại', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, dims: null })).toBe('lech-dau-vao');
    expect(xetCacheQuote(raw({ ...dauVao, dims: null }), dauVao)).toBe('lech-dau-vao');
  });
  it('ngày gửi đổi → phải quote lại (giá và %nhiên liệu theo ngày)', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, shipDate: '2026-10-15' })).toBe('lech-dau-vao');
  });
  /* Lỗi CEO bắt 15/10/2026: thiếu `packagingType` thì FedEx tính thang HỘP cho kiện TÚI. Dấu
   * phải chứa trường này, nếu không một dòng quote theo thang hộp sẽ đọc ra "còn dùng được". */
  it('loại bao gói đổi → phải quote lại', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, packagingType: null })).toBe('lech-dau-vao');
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, packagingType: 'YOUR_PACKAGING' })).toBe('lech-dau-vao');
  });
  /* Tên thành phố ĐỔI TIỀN: FedEx tra phụ phí vùng sâu xa theo tên của nó. Cùng mã bưu chính
   * 52728, "Al Bukayriyah" ra 1.678.505 còn "BUKAYRIYAH" ra 2.576.930 kèm OUT_OF_DELIVERY_AREA
   * 550.000 (đo `878423234737`). Thiếu nó trong dấu thì dòng quote tính theo tên cũ đọc ra
   * "còn dùng được". */
  it('thành phố đổi → phải quote lại', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, city: 'Al Bukayriyah' })).toBe('lech-dau-vao');
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, city: null })).toBe('lech-dau-vao');
  });
  it('dịch vụ đổi → phải quote lại', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, serviceType: 'INTERNATIONAL_ECONOMY' })).toBe('lech-dau-vao');
  });
  /* Dấu đời 1 (trước 15/10/2026) thiếu hẳn hai trường trên. So kiểu "trường vắng coi như
   * null" sẽ kết luận "còn dùng được" cho đúng những dòng tính sai thang giá. */
  it('dấu đời cũ → không-biết, KHÔNG phải còn-dùng-được', () => {
    const doiCu: Record<string, unknown> = { ...dauVao };
    delete doiCu.v; delete doiCu.packagingType; delete doiCu.serviceType; delete doiCu.city;
    expect(xetCacheQuote(raw({ ...doiCu, v: 1 }), dauVao)).toBe('khong-biet-dau-vao');
    expect(xetCacheQuote(raw(doiCu), dauVao)).toBe('khong-biet-dau-vao');
  });
  it('cờ ký nhận / nhà dân đổi → phải quote lại', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, signatureOptIn: false })).toBe('lech-dau-vao');
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, recipientResidential: false })).toBe('lech-dau-vao');
  });
  /* Sai số dấu phẩy động của numeric/jsonb không được tính là "đổi cân": quote lại mỗi lượt
   * là nhân lượt gọi hãng lên theo từng kiện khi cron quét hàng loạt. */
  it('lệch vụn dưới ngưỡng → vẫn còn dùng được', () => {
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, weightKg: 0.7000001 })).toBe('con-dung');
    expect(xetCacheQuote(raw(dauVao), { ...dauVao, dims: { length: 40.001, width: 31, height: 2 } }))
      .toBe('con-dung');
  });

  /* "Không biết" KHÁC "lệch", và người gọi đối xử với hai thứ đó khác nhau: dòng cũ không có
   * dấu (gồm 1.310 dòng trước 15/10/2026, phần lớn do backfill tạo từ cân tính phí của HOÁ
   * ĐƠN và đang là mốc đối soát của 1.224 kiện) phải được GIỮ NGUYÊN, không quote lại. */
  it('dòng cũ không có dấu đầu vào → không-biết, KHÔNG phải lệch', () => {
    expect(xetCacheQuote({ output: {} }, dauVao)).toBe('khong-biet-dau-vao');
    expect(xetCacheQuote(null, dauVao)).toBe('khong-biet-dau-vao');
    expect(xetCacheQuote('chuỗi lạ', dauVao)).toBe('khong-biet-dau-vao');
  });
  it('dấu méo (thiếu cân / dims không ra ba số) → không-biết, không đoán', () => {
    expect(xetCacheQuote(raw({ shipDate: '2026-10-14' }), dauVao)).toBe('khong-biet-dau-vao');
    expect(xetCacheQuote(raw({ ...dauVao, dims: { length: 40 } }), dauVao)).toBe('khong-biet-dau-vao');
  });
});
