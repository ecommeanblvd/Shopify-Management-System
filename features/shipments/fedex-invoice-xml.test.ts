import { describe, it, expect } from 'vitest';
import { parseFedexInvoiceXml } from './fedex-invoice-xml';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Download>
  <Invoice_Download>
    <Số_hóa_đơn_FedEx>734098485</Số_hóa_đơn_FedEx>
    <Ngày_lập_hóa_đơn>15-Jun-2026</Ngày_lập_hóa_đơn>
    <Ngày_đáo_hạn>05-Jul-2026</Ngày_đáo_hạn>
    <Tiền_tệ_thanh_toán>VND</Tiền_tệ_thanh_toán>
    <Số_vận_đơn_hàng_không>871902873959</Số_vận_đơn_hàng_không>
    <Số_tham_chiếu_của_người_gửi_1>#MBLVD28627</Số_tham_chiếu_của_người_gửi_1>
    <Ngày_vận_chuyển_đúng_định_dạng>18-May-2026</Ngày_vận_chuyển_đúng_định_dạng>
    <Dịch_vụ>FedEx International Priority</Dịch_vụ>
    <Trọng_lượng_thực_tế>1.2</Trọng_lượng_thực_tế>
    <Đơn_vị_trọng_lượng_thực_tế>K</Đơn_vị_trọng_lượng_thực_tế>
    <Số_tiền_theo_trọng_lượng_tính_cước>2.5</Số_tiền_theo_trọng_lượng_tính_cước>
    <Quốc_giavùng_lãnh_thổ_trong_địa_chỉ_của_người_nhận>US</Quốc_giavùng_lãnh_thổ_trong_địa_chỉ_của_người_nhận>
    <Mã_bưu_chính_trong_địa_chỉ_của_người_nhận>10310</Mã_bưu_chính_trong_địa_chỉ_của_người_nhận>
    <Tổng_số_tiền_trong_vận_đơn_hàng_không>1,890,091.00</Tổng_số_tiền_trong_vận_đơn_hàng_không>
    <Nhãn_phí_trên_vận_đơn_hàng_không>Fuel Surcharge</Nhãn_phí_trên_vận_đơn_hàng_không>
    <Số_tiền_phí_trên_vận_đơn_hàng_không>573,557.00</Số_tiền_phí_trên_vận_đơn_hàng_không>
    <Nhãn_phí_trên_vận_đơn_hàng_không>Automation Bonus</Nhãn_phí_trên_vận_đơn_hàng_không>
    <Số_tiền_phí_trên_vận_đơn_hàng_không>-355,537.00</Số_tiền_phí_trên_vận_đơn_hàng_không>
    <Nhãn_phí_trên_vận_đơn_hàng_không>Freight Charges</Nhãn_phí_trên_vận_đơn_hàng_không>
    <Số_tiền_phí_trên_vận_đơn_hàng_không>5,079,100.00</Số_tiền_phí_trên_vận_đơn_hàng_không>
    <Nhãn_phí_trên_vận_đơn_hàng_không>Base Discount</Nhãn_phí_trên_vận_đơn_hàng_không>
    <Số_tiền_phí_trên_vận_đơn_hàng_không>-3,646,286.00</Số_tiền_phí_trên_vận_đơn_hàng_không>
    <Nhãn_phí_trên_vận_đơn_hàng_không>Demand Surcharge</Nhãn_phí_trên_vận_đơn_hàng_không>
    <Số_tiền_phí_trên_vận_đơn_hàng_không>99,250.00</Số_tiền_phí_trên_vận_đơn_hàng_không>
    <Nhãn_phí_trên_vận_đơn_hàng_không>Vietnam VAT</Nhãn_phí_trên_vận_đơn_hàng_không>
    <Số_tiền_phí_trên_vận_đơn_hàng_không>140,007.00</Số_tiền_phí_trên_vận_đơn_hàng_không>
  </Invoice_Download>
  <Invoice_Download>
    <Số_hóa_đơn_FedEx>734098485</Số_hóa_đơn_FedEx>
    <Số_vận_đơn_hàng_không>999000111222</Số_vận_đơn_hàng_không>
    <Số_tham_chiếu_của_người_gửi_1>#MBLVD30000</Số_tham_chiếu_của_người_gửi_1>
    <Tổng_số_tiền_trong_vận_đơn_hàng_không>500,000.00</Tổng_số_tiền_trong_vận_đơn_hàng_không>
    <Nhãn_phí_trên_vận_đơn_hàng_không>Freight Charges</Nhãn_phí_trên_vận_đơn_hàng_không>
    <Số_tiền_phí_trên_vận_đơn_hàng_không>500,000.00</Số_tiền_phí_trên_vận_đơn_hàng_không>
  </Invoice_Download>
</Download>`;

describe('parseFedexInvoiceXml', () => {
  it('parse mỗi <Invoice_Download> → 1 FboBilledRow theo AWB', () => {
    const rows = parseFedexInvoiceXml(XML);
    expect(rows).toHaveLength(2);
    const r = rows[0];
    expect(r.awb).toBe('871902873959');
    expect(r.orderRef).toBe('#MBLVD28627');
    expect(r.invoiceNumber).toBe('734098485');
    expect(r.service).toBe('FedEx International Priority');
    expect(r.recipientCountry).toBe('US');
    expect(r.weightKg).toBe(2.5);
  });
  it('phân loại phí đúng bucket', () => {
    const r = parseFedexInvoiceXml(XML)[0];
    expect(r.base).toBe(5079100);
    expect(r.discount).toBe(-355537 + -3646286); // Automation Bonus + Base Discount
    expect(r.fuel).toBe(573557);
    expect(r.demand).toBe(99250);
    expect(r.vat).toBe(140007);
    expect(r.total).toBe(1890091); // ưu tiên Tổng số tiền trong vận đơn
  });
  it('XML rỗng/sai → []', () => {
    expect(parseFedexInvoiceXml('')).toEqual([]);
    expect(parseFedexInvoiceXml('<x/>')).toEqual([]);
  });
});

describe('đơn vị cân TÍNH CƯỚC độc lập với cân thực tế (bug #MBLVD29431, 03/08)', () => {
  const xml = (unitTags: string) => `<?xml version="1.0"?><root><Invoice_Download>
    <Số_hóa_đơn_FedEx>734110283</Số_hóa_đơn_FedEx>
    <Ngày_lập_hóa_đơn>03-Aug-2026</Ngày_lập_hóa_đơn>
    <Số_vận_đơn_hàng_không>874588278487</Số_vận_đơn_hàng_không>
    <Trọng_lượng_thực_tế>1</Trọng_lượng_thực_tế>
    ${unitTags}
    <Số_tiền_theo_trọng_lượng_tính_cước>0.5</Số_tiền_theo_trọng_lượng_tính_cước>
    <Tổng_số_tiền_trong_vận_đơn_hàng_không>1,602,175.00</Tổng_số_tiền_trong_vận_đơn_hàng_không>
  </Invoice_Download></root>`;

  it('cân thực 1 P nhưng cân tính cước 0.5 K → 0.5 kg (KHÔNG áp đơn vị P của cân thực)', () => {
    const r = parseFedexInvoiceXml(xml(
      '<Đơn_vị_trọng_lượng_thực_tế>P</Đơn_vị_trọng_lượng_thực_tế><Đơn_vị_trọng_lượng_tính_cước>K</Đơn_vị_trọng_lượng_tính_cước>',
    ))[0];
    expect(r.weightKg).toBe(0.5);
  });
  it('cân tính cước đơn vị P thật → quy lb→kg như cũ', () => {
    const r = parseFedexInvoiceXml(xml(
      '<Đơn_vị_trọng_lượng_thực_tế>P</Đơn_vị_trọng_lượng_thực_tế><Đơn_vị_trọng_lượng_tính_cước>P</Đơn_vị_trọng_lượng_tính_cước>',
    ))[0];
    expect(r.weightKg).toBe(0.227);
  });
});
