import { describe, expect, it } from 'vitest';
import { classifyFboCharge, parseFboAmount, parseFedexFbo } from './fedex-fbo-parse';

describe('classifyFboCharge', () => {
  const cases: Array<[string, string]> = [
    ['Freight Charges', 'base'], ['Transportation Charge', 'base'],
    ['Base Discount', 'discount'], ['Automation Bonus', 'discount'], ['Discount', 'discount'],
    ['Fuel Surcharge', 'fuel'], ['Demand Surcharge', 'demand'],
    ['Out of Delivery Area Tier B', 'remote'],
    ['Direct Signature Required', 'signature'], ['Adult Signature Required', 'signature'],
    ['Residential Delivery', 'residential'],
    ['US Inbound Processing Fee', 'importHandling'], ['Phí xử lí hàng nhập khẩu vào Hoa Kỳ', 'importHandling'],
    ['Vietnam VAT', 'vat'], ['VAT/Consumption Tax', 'vat'], ['UAE Freight VAT', 'vat'],
    ['Duty & Tax', 'duty'], ['Customs Duty', 'duty'], ['Disbursement Fee', 'duty'],
    ['Address Correction', 'other'], ['Other', 'other'],
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
