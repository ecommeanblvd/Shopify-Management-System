import { describe, expect, it } from 'vitest';
import { classifyFboCharge, parseFboAmount, parseFedexFbo, consolidateFboShipping, fboChargeUnchanged, parseFboPod } from './fedex-fbo-parse';
import type { FboBilledRow } from './fedex-fbo-parse';

describe('fboChargeUnchanged (re-import diff)', () => {
  it('DB "1890091.00" vs ghi mới "1890091" → coi như KHÔNG đổi (so theo số)', () => {
    expect(fboChargeUnchanged(
      { totalAmount: '1890091.00', base: '5079100.00', fuel: '573557.00', vat: '140007.00', billingWeightKg: '2.50' },
      { totalAmount: '1890091', base: '5079100', fuel: '573557', vat: '140007', billingWeightKg: '2.5' },
    )).toBe(true);
  });
  it('khác total → ĐỔI', () => {
    expect(fboChargeUnchanged({ totalAmount: '1890091.00' }, { totalAmount: '1900000' })).toBe(false);
  });
  it('khác 1 khoản breakdown (fuel) → ĐỔI', () => {
    expect(fboChargeUnchanged(
      { totalAmount: '100', fuel: '10' }, { totalAmount: '100', fuel: '12' },
    )).toBe(false);
  });
  it('billingWeightKg null cả hai → không đổi; lệch null/số → đổi', () => {
    expect(fboChargeUnchanged({ totalAmount: '100', billingWeightKg: null }, { totalAmount: '100', billingWeightKg: null })).toBe(true);
    expect(fboChargeUnchanged({ totalAmount: '100', billingWeightKg: null }, { totalAmount: '100', billingWeightKg: '1' })).toBe(false);
  });
});

function mkRow(p: Partial<FboBilledRow>): FboBilledRow {
  return {
    awb: 'X', orderRef: null, invoiceNumber: null, invoiceDate: null, dueDate: null, podAt: null, podName: null,
    shipDate: null, service: null, recipientCountry: null, recipientStreet1: null,
    recipientStreet2: null, recipientCity: null, recipientState: null, recipientPostcode: null,
    weightKg: null, base: 0, discount: 0, fuel: 0, demand: 0, remote: 0, signature: 0,
    residential: 0, addressCorrection: 0, importHandling: 0, vat: 0, duty: 0, other: 0, total: 0, ...p,
  };
}

describe('classifyFboCharge', () => {
  const cases: Array<[string, string]> = [
    ['Freight Charges', 'base'], ['Transportation Charge', 'base'],
    ['Base Discount', 'discount'], ['Automation Bonus', 'discount'], ['Discount', 'discount'],
    ['Fuel Surcharge', 'fuel'], ['Demand Surcharge', 'demand'],
    ['Out of Delivery Area Tier B', 'remote'],
    ['Direct Signature Required', 'signature'], ['Adult Signature Required', 'signature'],
    ['Residential Delivery', 'residential'],
    ['US Inbound Processing Fee', 'importHandling'], ['Phí xử lí hàng nhập khẩu vào Hoa Kỳ', 'importHandling'],
    ['Vietnam VAT', 'vat'], ['UAE Freight VAT', 'vat'], ['Vietnam VAT Freight', 'vat'],
    ['VAT/Consumption Tax', 'duty'], ['Consumption Tax', 'duty'],
    ['Duty & Tax', 'duty'], ['Customs Duty', 'duty'], ['Disbursement Fee', 'duty'], ['Duty Disbursement Fee', 'duty'],
    ['Address Correction', 'addressCorrection'], ['Address Correction Charge', 'addressCorrection'], ['Other', 'other'],
  ];
  it.each(cases)('"%s" → %s', (label, bucket) => {
    expect(classifyFboCharge(label)).toBe(bucket);
  });
});

describe('parseFboAmount', () => {
  it('bóc số có dấu phẩy + âm', () => {
    expect(parseFboAmount('1,371,600.00')).toBe(1_371_600);
    expect(parseFboAmount('-672,084.00')).toBe(-672_084);
    expect(parseFboAmount('')).toBe(0);
    expect(parseFboAmount(88_000)).toBe(88_000);
  });
});

describe('parseFedexFbo (cấu trúc thật)', () => {
  // Header rút gọn theo đúng tên cột FBO + 2 cặp nhãn/số tiền.
  const header = [
    'Số hóa đơn FedEx', 'Ngày lập hóa đơn', 'Ngày đáo hạn', 'Số vận đơn hàng không',
    'Số tham chiếu của người gửi 1', 'Ngày vận chuyển (đúng định dạng)', 'Dịch vụ',
    'Quốc gia/vùng lãnh thổ trong địa chỉ của người nhận', 'Tổng số tiền trong vận đơn hàng không',
    'Nhãn phí trên vận đơn hàng không', 'Số tiền phí trên vận đơn hàng không',
    'Nhãn phí trên vận đơn hàng không', 'Số tiền phí trên vận đơn hàng không',
    'Nhãn phí trên vận đơn hàng không', 'Số tiền phí trên vận đơn hàng không',
  ];
  // Đơn AWB 881907346391 (#24-INSLG): Freight + Base Discount + Fuel + Signature + VAT.
  const row = [
    '734001324', '17-Jun-2025', '07-Jul-2025', '881907346391', '#MBLVD24535',
    '10-Jun-2025', '2P PAK', 'HK', '1,092,915.00',
    'Freight Charges', '1,371,600.00',
    'Base Discount', '-672,084.00',
    'Fuel Surcharge', '224,442.00',
  ];
  // dòng 2 thêm signature + vat ở cùng cấu trúc (mở rộng cặp)
  const header2 = [...header, 'Nhãn phí trên vận đơn hàng không', 'Số tiền phí trên vận đơn hàng không',
    'Nhãn phí trên vận đơn hàng không', 'Số tiền phí trên vận đơn hàng không'];
  const row2 = [...row, 'Direct Signature Required', '88,000.00', 'Vietnam VAT', '80,957.00'];

  it('bóc metadata + gom phụ phí theo mục', () => {
    const [r] = parseFedexFbo([header2, row2]);
    expect(r.awb).toBe('881907346391');
    expect(r.orderRef).toBe('#MBLVD24535');
    expect(r.invoiceNumber).toBe('734001324');
    expect(r.base).toBe(1_371_600);
    expect(r.discount).toBe(-672_084);
    expect(r.fuel).toBe(224_442);
    expect(r.signature).toBe(88_000);
    expect(r.vat).toBe(80_957);
    expect(r.total).toBe(1_092_915);
    // tổng các mục = total (kiểm chứng số học khớp hoá đơn)
    expect(r.base + r.discount + r.fuel + r.signature + r.vat).toBe(1_092_915);
  });

  it('bỏ dòng không có AWB', () => {
    const blank = new Array(header2.length).fill('');
    expect(parseFedexFbo([header2, blank])).toHaveLength(0);
  });
});

describe('consolidateFboShipping (AWB nhiều dòng cước+thuế)', () => {
  it('lấy dòng cước (duty=0), bỏ dòng thuế/hải quan', () => {
    const ship = mkRow({ awb: 'A', base: 4_627_300, discount: -3_643_999, fuel: 309_865, demand: 85_200, vat: 110_269, total: 1_488_635 });
    const customs = mkRow({ awb: 'A', duty: 14_586_455, other: 472_317, total: 15_058_772 });
    const out = consolidateFboShipping([ship, customs]);
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(1_488_635);
    expect(out[0].duty).toBe(0);
  });

  it('AWB chỉ có dòng thuế → bỏ (không lưu thuế thành cước)', () => {
    expect(consolidateFboShipping([mkRow({ awb: 'B', duty: 5_000_000, total: 5_000_000 })])).toHaveLength(0);
  });

  it('AWB 1 dòng cước thường → giữ nguyên', () => {
    expect(consolidateFboShipping([mkRow({ awb: 'C', base: 100, total: 100 })])).toHaveLength(1);
  });
});

describe('parseFboPod', () => {
  it('20260707 + 11:27 → 2026-07-07T11:27:00', () => {
    expect(parseFboPod('20260707', '11:27')).toBe('2026-07-07T11:27:00');
  });
  it('thiếu giờ → 00:00; giờ 1 chữ số pad; sai định dạng ngày → null', () => {
    expect(parseFboPod('20260707', null)).toBe('2026-07-07T00:00:00');
    expect(parseFboPod('20260707', '9:05')).toBe('2026-07-07T09:05:00');
    expect(parseFboPod('07-07-2026', '11:27')).toBeNull();
    expect(parseFboPod(null, '11:27')).toBeNull();
    expect(parseFboPod('', '')).toBeNull();
  });
});

describe('classifyFboCharge — nhãn bắt thêm 21/07', () => {
  it('Out of Pickup Area → remote (mirror của Out of Delivery Area)', () => {
    expect(classifyFboCharge('Out of Pickup Area Tier B')).toBe('remote');
  });
  it('Additional Handling / Third Party Billing → other (đã nhận diện, chưa đủ tần suất tách cột)', () => {
    expect(classifyFboCharge('Additional Handling Chg - Packaging')).toBe('other');
    expect(classifyFboCharge('Third Party Billing Surcharge')).toBe('other');
  });
});
