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
    residential: 0, addressCorrection: 0, importHandling: 0, vat: 0, duty: 0, additionalHandling: 0, other: 0, total: 0, ...p,
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
  /* ĐẢO quyết định 21/07 cho riêng Additional Handling (08/10/2026). Hồi đó nhãn này được
     nhận diện và CỐ Ý để ở `other` vì "chưa đủ tần suất tách cột" — tần suất là tiêu chí sai ở
     đây: khoản này CHỊU fuel, nên nằm ngoài gốc tính fuel thì tỉ lệ ra sai bất kể gặp mấy lần.
     Đo lại trên hai vận đơn thật, xem `goc-fuel-bill.test.ts`. Third Party Billing giữ nguyên
     ở `other` — chưa có bằng chứng nó chịu fuel. */
  it('Third Party Billing vẫn → other, chưa có bằng chứng về fuel', () => {
    expect(classifyFboCharge('Third Party Billing Surcharge')).toBe('other');
  });
});

describe('classifyFboCharge — thuế nhập khẩu của NƯỚC ĐẾN (CEO 07/10/2026)', () => {
  /* Đơn 26-INSLG-SV-0158 (AWB 877737149702): hoá đơn thuế 736062060 có hai nhãn —
   *   Canada HST            172.995
   *   Duty Disbursement Fee 225.891
   * Trên bill là MỘT khoản "duty and tax" 398.886, nhưng "Canada HST" không khớp luật nào nên
   * rơi vào `other`, và bảng kê gửi brand tách thành "Phụ phí khác (chưa phân loại)" + "Thuế /
   * hải quan". HST là thuế tiêu thụ khi NHẬP, cùng bản chất "VAT/Consumption Tax" vốn đã xếp
   * vào `duty` — không phải VAT cước. */
  it('thuế tiêu thụ của nước đến → duty, không rơi vào chưa phân loại', () => {
    expect(classifyFboCharge('Canada HST')).toBe('duty');
    expect(classifyFboCharge('Canada GST')).toBe('duty');
    expect(classifyFboCharge('QST')).toBe('duty');
  });

  /* VAT CƯỚC vẫn phải ở `vat` — đây là khoản mình trả cho FedEx trên chính cước, khác hẳn thuế
     nhập khẩu thu hộ người nhận. */
  it('VAT cước không bị kéo sang duty', () => {
    expect(classifyFboCharge('Vietnam VAT')).toBe('vat');
    expect(classifyFboCharge('UAE Freight VAT')).toBe('vat');
  });

  /* Không nuốt nhầm chữ khác có chứa 3 ký tự đó. */
  it('không khớp nhầm nhãn chỉ TÌNH CỜ chứa hst/gst', () => {
    expect(classifyFboCharge('Ghost Package Handling')).not.toBe('duty');
  });
});

describe('classifyFboCharge — phí thông quan hàng TRẢ VỀ (CEO 08/10/2026)', () => {
  /* Hoá đơn 734119505 gom 4 vận đơn hàng trả về Hà Nội (ref `#MBLVD...._R`, đơn gốc đã hoàn
   * tiền). Mỗi vận đơn có: Duty & Tax 385.836 · Duty Disbursement Fee 150.000 · Customs Fee
   * 10.000 · Informal Clearance 250.000 · Vietnam VAT 32.000.
   *
   * VAT 32.000 = ĐÚNG 8% × (150.000 + 250.000) → VAT đánh trên hai khoản DỊCH VỤ của FedEx,
   * không đánh trên thuế. Trong hệ thống `duty` là pass-through thuần KHÔNG VAT, còn
   * `importHandling` là phí xử lý hàng nhập CÓ VAT — nên Informal Clearance thuộc nhóm sau. */
  it('Informal Clearance → importHandling, không còn rơi vào chưa phân loại', () => {
    expect(classifyFboCharge('Informal Clearance')).toBe('importHandling');
  });

  /* Các khoản cùng hoá đơn phải giữ nguyên chỗ cũ — sửa một nhãn không được kéo nhãn khác đi. */
  it('không xê dịch các khoản thông quan khác', () => {
    expect(classifyFboCharge('Duty  Tax')).toBe('duty');
    expect(classifyFboCharge('Customs Fee')).toBe('duty');
    expect(classifyFboCharge('Duty Disbursement Fee')).toBe('duty');
    expect(classifyFboCharge('Vietnam VAT')).toBe('vat');
  });
});

describe('classifyFboCharge — Additional Handling (CEO 08/10/2026)', () => {
  /* Hai ca thật: AHS-Packaging 679.700 trên #MBLVD28701 (đóng gói không đúng chuẩn — có cuốn
   * thêm màng bọc ngoài), và AHS-Dimensions 679.700 trên TA2337 (FedEx liệt kê đơn hơn 20kg
   * nên áp phụ phí; đang khiếu nại hãng). Khoản này CHỊU fuel — xem `goc-fuel-bill`. */
  it('Additional Handling có thùng riêng, không rơi vào chưa phân loại', () => {
    expect(classifyFboCharge('Additional Handling Chg - Packaging')).toBe('additionalHandling');
    expect(classifyFboCharge('Additional Handling Chg - Dimensions')).toBe('additionalHandling');
  });

  /* FedEx còn một biến thể mùa cao điểm gộp vào phụ phí nhu cầu — giữ nguyên chỗ cũ, vì nó
     đứng tên "Demand" và vốn đã nằm trong gốc fuel qua thùng `demand`. */
  it('biến thể Demand vẫn ở thùng demand như cũ', () => {
    expect(classifyFboCharge('Demand - Additional Handling Surcharge')).toBe('demand');
  });
});
