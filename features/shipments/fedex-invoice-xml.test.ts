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

// FedEx Billing Online xuất được cả bản tiếng Việt lẫn tiếng Anh, cùng đuôi
// .XML và cùng thẻ gốc <Download> — nhìn ngoài không phân biệt được. Parser
// chỉ biết bộ tên tiếng Việt nên bản tiếng Anh bị từ chối thẳng (CEO gặp
// 28/08 với hoá đơn thuế/hải quan 15 vận đơn).
describe('bản tiếng Anh của FedEx Billing Online', () => {
  const XML_EN = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Download>
  <Invoice_Download>
    <Invoice_Type>Duty/Tax</Invoice_Type>
    <FedEx_Invoice_Number>736058494</FedEx_Invoice_Number>
    <Invoice_Date>25-Aug-2026</Invoice_Date>
    <Due_Date>01-Sep-2026</Due_Date>
    <Air_Waybill_Number>875846036965</Air_Waybill_Number>
    <Shipper_Reference_1>26-INSLG-SV-0895</Shipper_Reference_1>
    <Ship_Date_formatted>17-Aug-2026</Ship_Date_formatted>
    <Service>2P</Service>
    <Recipient_Address_City>ANTWERPEN</Recipient_Address_City>
    <Recipient_Address_Postcode>2018</Recipient_Address_Postcode>
    <Recipient_Address_CountryTerritory>BE</Recipient_Address_CountryTerritory>
    <Rated_Weight_Amount>2.6</Rated_Weight_Amount>
    <Rated_Weight_Units>K</Rated_Weight_Units>
    <Air_Waybill_Total_Amount>1,438,863.00</Air_Waybill_Total_Amount>
    <Air_Waybill_Charge_Label>Duty  Tax</Air_Waybill_Charge_Label>
    <Air_Waybill_Charge_Amount>295,287.00</Air_Waybill_Charge_Amount>
    <Air_Waybill_Charge_Label>VATConsumption Tax</Air_Waybill_Charge_Label>
    <Air_Waybill_Charge_Amount>677,824.00</Air_Waybill_Charge_Amount>
    <Air_Waybill_Charge_Label>Duty Disbursement Fee</Air_Waybill_Charge_Label>
    <Air_Waybill_Charge_Amount>465,752.00</Air_Waybill_Charge_Amount>
  </Invoice_Download>
</Download>`;

  it('đọc được vận đơn, số hoá đơn và ngày', () => {
    const rows = parseFedexInvoiceXml(XML_EN);
    expect(rows).toHaveLength(1);
    expect(rows[0].awb).toBe('875846036965');
    expect(rows[0].invoiceNumber).toBe('736058494');
    expect(rows[0].invoiceDate).toBe('25-Aug-2026');
  });

  it('đọc được mã đơn từ tham chiếu người gửi', () => {
    expect(parseFedexInvoiceXml(XML_EN)[0].orderRef).toBe('26-INSLG-SV-0895');
  });

  it('đọc được cân tính cước kèm đơn vị', () => {
    expect(parseFedexInvoiceXml(XML_EN)[0].weightKg).toBeCloseTo(2.6, 3);
  });

  it('đọc được nước và mã bưu chính người nhận', () => {
    const r = parseFedexInvoiceXml(XML_EN)[0];
    expect(r.recipientCountry).toBe('BE');
    expect(r.recipientPostcode).toBe('2018');
  });

  it('đọc đúng tổng vận đơn', () => {
    expect(parseFedexInvoiceXml(XML_EN)[0].total).toBe(1438863);
  });

  // Nhãn phí trong bản tiếng Anh cũng khác ("Duty  Tax" thay vì "Thuế/Phí hải
  // quan"). Không phân loại được thì tiền dồn hết vào "khoản khác" và đối soát
  // không biết đó là thuế hay cước.
  it('phân loại được nhãn phí tiếng Anh, không dồn hết vào khoản khác', () => {
    const r = parseFedexInvoiceXml(XML_EN)[0];
    const tongPhi = 295287 + 677824 + 465752;
    expect(r.duty + r.vat + r.importHandling + r.other).toBe(tongPhi);
    expect(r.other).toBeLessThan(tongPhi);
  });

  it('bản tiếng Việt vẫn đọc như cũ', () => {
    const XML_VI = `<Download><Invoice_Download>
      <Số_vận_đơn_hàng_không>111222333</Số_vận_đơn_hàng_không>
      <Số_hóa_đơn_FedEx>999</Số_hóa_đơn_FedEx>
      <Số_tiền_theo_trọng_lượng_tính_cước>1.5</Số_tiền_theo_trọng_lượng_tính_cước>
      <Đơn_vị_trọng_lượng_tính_cước>K</Đơn_vị_trọng_lượng_tính_cước>
    </Invoice_Download></Download>`;
    const r = parseFedexInvoiceXml(XML_VI);
    expect(r).toHaveLength(1);
    expect(r[0].awb).toBe('111222333');
    expect(r[0].weightKg).toBeCloseTo(1.5, 3);
  });
});
