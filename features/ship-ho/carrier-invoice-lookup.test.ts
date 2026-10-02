import { describe, it, expect } from 'vitest';
import { normalizeBilledLine, costToVndFactor, billImpliedFuelPercent, aggregateBilledLines, billedHasFreight, type RawBillLine, type BilledSurcharges, type BilledLookup } from './carrier-invoice-lookup';

const raw: RawBillLine = {
  weightKg: '2.500', base: '1000000', discount: '-50000', fuel: '180000', remote: '0',
  demand: '25000', signature: '0', vat: '150000', other: '0', addressCorrection: null, importHandling: null, duty: null, total: '1305000', shipDate: '2026-07-02',
};

describe('costToVndFactor', () => {
  it('cost VND → 1', () => expect(costToVndFactor('VND', 'USD', 26000)).toBe(1));
  it('display VND, cost khác → 1/fx', () => expect(costToVndFactor('USD', 'VND', 1 / 26000)).toBe(26000));
  it('không quy được → null', () => expect(costToVndFactor('USD', 'USD', 1)).toBeNull());
});

describe('normalizeBilledLine', () => {
  it('cost VND (factor 1): giữ nguyên số, tách phụ phí', () => {
    const b = normalizeBilledLine(raw, 1, 'HANR000265761');
    expect(b.weightKg).toBe(2.5);
    expect(b.totalVnd).toBe(1_305_000);
    expect(b.surcharges.fuel).toBe(180_000);
    expect(b.surcharges.discount).toBe(-50_000);
    expect(b.billNumber).toBe('HANR000265761');
    expect(b.shipDate).toBe('2026-07-02');
  });
  it('cost USD → quy VND theo factor', () => {
    const usd: RawBillLine = { ...raw, total: '50', fuel: '9', base: '40', weightKg: '2', discount: '0', remote: '0', demand: '0', signature: '0', vat: '0', other: '0' };
    const b = normalizeBilledLine(usd, 26_000, 'X');
    expect(b.totalVnd).toBe(1_300_000); // 50 × 26,000
    expect(b.surcharges.fuel).toBe(234_000); // 9 × 26,000
  });
  it('null/rỗng → 0 cho phụ phí, weight null', () => {
    const empty: RawBillLine = { weightKg: null, base: null, discount: null, fuel: null, remote: null, demand: null, signature: null, vat: null, other: null, addressCorrection: null, importHandling: null, duty: null, total: '0', shipDate: null };
    const b = normalizeBilledLine(empty, 1, null);
    expect(b.weightKg).toBeNull();
    expect(b.totalVnd).toBe(0);
    expect(b.surcharges.base).toBe(0);
    expect(b.shipDate).toBeNull();
  });
});

describe('billImpliedFuelPercent — fuel % FedEx THỰC ÁP suy từ chính bill', () => {
  const s = (over: Partial<BilledSurcharges>): BilledSurcharges => ({
    base: 0, discount: 0, fuel: 0, remote: 0, demand: 0, signature: 0, vat: 0,
    other: 0, residential: 0, addressCorrection: 0, importHandling: 0, duty: 0, ...over,
  });
  it('SV-0016 thật: fuel 393.038 / (4.470.300 − 3.522.149 + demand 79.400) = 38,25%', () => {
    expect(billImpliedFuelPercent(s({ base: 4_470_300, discount: -3_522_149, fuel: 393_038, demand: 79_400 }))).toBe(38.25);
  });
  it('SV-0015 thật: AC chịu fuel — 507.718 / (3.442.200 − 2.404.032 + AC 289.200) = 38,25%', () => {
    expect(billImpliedFuelPercent(s({ base: 3_442_200, discount: -2_404_032, fuel: 507_718, addressCorrection: 289_200 }))).toBe(38.25);
  });
  it('lượng tử hoá bậc 0,25 (FedEx công bố theo bước 0,25%)', () => {
    // 385/1000 = 38.5% chính xác; lệch làm tròn vài đồng vẫn về đúng bậc.
    expect(billImpliedFuelPercent(s({ base: 1_000_000, fuel: 385_003 }))).toBe(38.5);
  });
  it('bill không có fuel (0) → null (caller fallback engine)', () => {
    expect(billImpliedFuelPercent(s({ base: 1_000_000, fuel: 0 }))).toBeNull();
  });
  it('base chịu fuel ≤ 0 → null', () => {
    expect(billImpliedFuelPercent(s({ base: 100, discount: -200, fuel: 50 }))).toBeNull();
  });
  it('tỉ lệ vô lý (>100%) → null, không tin dòng bill hỏng', () => {
    expect(billImpliedFuelPercent(s({ base: 100_000, fuel: 200_000 }))).toBeNull();
  });
});

describe('aggregateBilledLines — 1 lô hàng có NHIỀU dòng bill (cước 734xxx + duty 736xxx)', () => {
  const mk = (over: Partial<BilledLookup['surcharges']>, extra?: Partial<BilledLookup>): BilledLookup => ({
    weightKg: null, totalVnd: 0, billNumber: null, shipDate: null,
    surcharges: { base: 0, discount: 0, fuel: 0, remote: 0, demand: 0, signature: 0, vat: 0, other: 0, residential: 0, addressCorrection: 0, importHandling: 0, duty: 0, ...over },
    ...extra,
  });
  it('SV-0029 thật: dòng duty đứng trước + dòng cước — gộp đủ cả hai', () => {
    const duty = mk({ duty: 370_658 }, { totalVnd: 370_658, billNumber: '736056168', weightKg: 8.3 });
    const freight = mk({ base: 11_176_700, discount: -7_500_000, fuel: 1_400_000, vat: 300_000 }, { totalVnd: 4_587_478, billNumber: '734110283', weightKg: 8.3, shipDate: '2026-07-20' });
    const agg = aggregateBilledLines([duty, freight]);
    expect(agg.surcharges.base).toBe(11_176_700);
    expect(agg.surcharges.duty).toBe(370_658);
    expect(agg.totalVnd).toBe(4_958_136); // cước + duty
    expect(agg.weightKg).toBe(8.3);
    expect(agg.shipDate).toBe('2026-07-20'); // lấy từ dòng có ship date
    expect(agg.billNumber).toBe('736056168 + 734110283');
  });
  it('1 dòng duy nhất → giữ nguyên', () => {
    const one = mk({ base: 100, discount: -20 }, { totalVnd: 80, billNumber: 'B1', weightKg: 1 });
    expect(aggregateBilledLines([one])).toEqual(one);
  });
  it('billedHasFreight: chỉ có duty (bill cước chưa về) → false', () => {
    expect(billedHasFreight(mk({ duty: 370_658 }, { totalVnd: 370_658 }))).toBe(false);
    expect(billedHasFreight(mk({ base: 1_000_000, discount: -700_000 }, { totalVnd: 300_000 }))).toBe(true);
  });
});

describe('costToVndFactor — tiền tệ của CHÍNH hoá đơn thắng cấu hình tài khoản (28/09/2026)', () => {
  /* Tài khoản "Aramex HN (Hợp Nhất)" khai cost=USD, fx=0,0000377858 → hệ số 26.465.
     Nhưng hoá đơn của chính nó lại ghi VND. Đơn #KLS2098 vì thế có chi thực
     36.153.052.205đ trong khi hoá đơn thật là 1.366.072đ — gấp đúng 26.465 lần,
     và báo cáo ship của Kalisa phình lên 78 TỶ. */
  it('hoá đơn ghi VND thì hệ số là 1, bất kể tài khoản khai USD', () => {
    expect(costToVndFactor('USD', 'VND', 0.0000377858, 'VND')).toBe(1);
  });

  it('không có tiền tệ hoá đơn → giữ nguyên luật cũ theo cấu hình tài khoản', () => {
    expect(costToVndFactor('VND', 'USD', 26000)).toBe(1);
    expect(costToVndFactor('USD', 'VND', 0.0000377858)).toBeCloseTo(26465, 0);
  });

  it('hoá đơn khớp cấu hình → vẫn quy đổi như cũ', () => {
    expect(costToVndFactor('VND', 'USD', 26000, 'VND')).toBe(1);
  });

  it('hoá đơn ghi một loại tiền KHÁC cấu hình và không phải VND → null, KHÔNG đoán tỉ giá', () => {
    expect(costToVndFactor('USD', 'VND', 0.0000377858, 'EUR')).toBeNull();
    expect(costToVndFactor('VND', 'USD', 26000, 'SAR')).toBeNull();
  });
});

/**
 * MMP hỏi 30/09/2026: tài liệu nói `signature` đã gộp phí giao nhà dân, nhưng danh sách mã vẫn
 * có `residential` riêng — bảng kê mang cả hai thì nhà dân bị thu hai lần, mà Σ vẫn khớp nên
 * bộ kiểm của họ không bắt được.
 *
 * Trả lời là KHÔNG thu hai lần, và đây là chỗ canh điều đó: hoá đơn FedEx ghi CHUNG hai khoản
 * vào cột `signature`; SMS lấy phần nhà dân từ nguồn khác (`shipment_charges.residential`) rồi
 * TRỪ khỏi signature. Nên `signature + residential` luôn bằng đúng dòng gộp trên hoá đơn —
 * không thừa, không thiếu, bất kể tách hay không tách.
 */
describe('normalizeBilledLine — signature ĐÃ TRỪ residential (bất biến MMP hỏi)', () => {
  const co = (signature: string, residentialRaw: string | null): BilledSurcharges =>
    normalizeBilledLine({ ...raw, signature, residentialRaw }, 1, null).surcharges;

  it('có tách: signature + residential = ĐÚNG dòng gộp trên hoá đơn, không thu hai lần', () => {
    const s = co('177100', '84400');
    expect(s.signature).toBe(92_700);
    expect(s.residential).toBe(84_400);
    expect(s.signature + s.residential).toBe(177_100);
  });

  it('không tách được (nguồn nhà dân trống): signature giữ NGUYÊN khoản gộp, residential = 0', () => {
    const s = co('177100', null);
    expect(s.signature).toBe(177_100);
    expect(s.residential).toBe(0);
    expect(s.signature + s.residential).toBe(177_100);
  });

  it('nhà dân lớn hơn dòng gộp (lệch dữ liệu) → signature kẹp ≥ 0, KHÔNG ra số âm', () => {
    const s = co('84400', '92700');
    expect(s.signature).toBe(0);
    expect(s.residential).toBe(92_700);
  });

  it('không có khoản ký nhận nào → cả hai bằng 0', () => {
    const s = co('0', null);
    expect(s.signature).toBe(0);
    expect(s.residential).toBe(0);
  });
});

describe('normalizeBilledLine — cột residential thắng đường lùi shipment_charges', () => {
  const mkRaw = (over: Partial<RawBillLine>): RawBillLine => ({ ...raw, ...over });

  /* Dòng nhập TỪ migration 0194 trở đi có cột riêng: signature đã sạch, không trừ gì nữa.
     Trừ thêm lần nữa là ăn mất 84.400 của dòng ký nhận. */
  it('có cột riêng → dùng thẳng cả hai, không trừ', () => {
    const r = normalizeBilledLine(
      mkRaw({ signature: '92700', residentialCot: '84400', residentialRaw: '84400', total: '1177100' }), 1, null);
    expect(r.surcharges.signature).toBe(92_700);
    expect(r.surcharges.residential).toBe(84_400);
  });

  /* Lô thật sự không có phí giao nhà dân vẫn ghi 0 — và 0 đó là số ĐÚNG, không được coi là
     "chưa có cột" rồi rơi về đường lùi. */
  it('cột riêng bằng 0 vẫn là có cột, không rơi về shipment_charges', () => {
    const r = normalizeBilledLine(
      mkRaw({ signature: '92700', residentialCot: '0', residentialRaw: '84400', total: '1092700' }), 1, null);
    expect(r.surcharges.signature).toBe(92_700);
    expect(r.surcharges.residential).toBe(0);
  });

  it('dòng CŨ (cột trống) vẫn tách bằng shipment_charges như trước', () => {
    const r = normalizeBilledLine(
      mkRaw({ signature: '177100', residentialRaw: '84400', total: '1177100' }), 1, null);
    expect(r.surcharges.signature).toBe(92_700);
    expect(r.surcharges.residential).toBe(84_400);
  });
});
