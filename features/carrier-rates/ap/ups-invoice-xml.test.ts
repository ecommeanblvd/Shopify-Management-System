import { describe, it, expect } from 'vitest';
import { parseUpsInvoiceXml, thungChoKhoanUps, laHoaDonUpsXml } from './ups-invoice-xml';

/**
 * Trích từ hoá đơn UPS THẬT 100000813108 (06/10/2026): giữ nguyên mọi con SỐ, đổi tên và
 * địa chỉ người gửi/nhận. Gồm đủ bốn ca mà file thật có:
 *   1. lô thường, kiện có phí + kiện `INF` 0đ đi kèm;
 *   2. lô bị ĐIỀU CHỈNH — cùng vận đơn xuất hiện ở nhóm ADJ rồi lại ở nhóm SHP;
 *   3. phí sửa địa chỉ nằm dưới class FRT (không phải ACC);
 *   4. mã phí ACC lạ → cột "Khác" + nêu tên ra.
 */
const XML = `<?xml version="1.0" encoding="ISO-8859-1" ?><UPS_EBR_BILL xmlns="http://www.ups.com/XMLSchema/EBR/Billing/v1">
<XMLBillFileVersion>1.0.8</XMLBillFileVersion>
<Recipient><RecipientNumber>00002050VD</RecipientNumber></Recipient>
<InvoiceDetails>
<Invoice><InvoiceNumber>100000813108   </InvoiceNumber><InvoiceDateCCYYMMDD>20261006</InvoiceDateCCYYMMDD><InvoiceCurrencyCode>VND</InvoiceCurrencyCode><InvoiceAmount>3321900.00</InvoiceAmount><InvoiceDueDateCCYYMMDD>20261105</InvoiceDueDateCCYYMMDD><TaxVarianceAmount>7746.00</TaxVarianceAmount>

<TransactionDetails><ChargeCategoryCode>ADJ</ChargeCategoryCode><ChargeCategoryDetailCode>RADJ</ChargeCategoryDetailCode>
<Shipment><TransactionDateCCYYMMDD>20260909</TransactionDateCCYYMMDD><LeadShipmentNumber>1Z2050VDDG27304524</LeadShipmentNumber>
<ShipmentReferences><Reference><Sequence>1</Sequence><ReferenceNumber>#MBLVD30078</ReferenceNumber></Reference></ShipmentReferences>
<Package><TrackingNumber>1Z2050VDDG27304524</TrackingNumber><ContainerType>PKG</ContainerType>
<PackageWeight><ActualWeight><Weight>0.0</Weight><UnitOfMeasure>K</UnitOfMeasure></ActualWeight><BilledWeight><Weight>3.0</Weight><UnitOfMeasure>K</UnitOfMeasure></BilledWeight></PackageWeight>
<ChargeDetails>
<Charge><ClassificationCode>FRT</ClassificationCode>
<ChargeInformation><DescriptionCode>008  </DescriptionCode><DescriptionOfCharges>WW Expedited Adjustment</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>140060.00</NetAmount></ChargeInformation>
</Charge>
<Charge><ClassificationCode>TAX</ClassificationCode>
<ChargeInformation><DescriptionCode>01   </DescriptionCode><DescriptionOfCharges>8.000 % Tax</DescriptionOfCharges><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>11045.00</NetAmount></ChargeInformation>
</Charge>
</ChargeDetails>
</Package>
</Shipment>
</TransactionDetails>

<TransactionDetails><ChargeCategoryCode>SHP</ChargeCategoryCode><ChargeCategoryDetailCode>NSD </ChargeCategoryDetailCode>
<Shipment><TransactionDateCCYYMMDD>20260903</TransactionDateCCYYMMDD><LeadShipmentNumber>1Z2050VDDG01187227</LeadShipmentNumber><BillOptionCode>P/P</BillOptionCode><PayerRoleCd>01</PayerRoleCd>
<ShipmentReferences><Reference><Sequence>1</Sequence><ReferenceNumber>#MBLVD29946</ReferenceNumber></Reference></ShipmentReferences>
<Package><TrackingNumber>1Z2050VDDG01187227</TrackingNumber><Zone>005</Zone><ContainerType>PKG</ContainerType>
<PackageWeight><ActualWeight><Weight>1.0</Weight><UnitOfMeasure>K</UnitOfMeasure></ActualWeight><BilledWeight><Weight>1.5</Weight><UnitOfMeasure>K</UnitOfMeasure></BilledWeight><BilledWeightType>29 </BilledWeightType></PackageWeight>
<ChargeDetails>
<Charge><ClassificationCode>FRT</ClassificationCode>
<ChargeInformation><DescriptionCode>008  </DescriptionCode><DescriptionOfCharges>WW Expedited</DescriptionOfCharges><ChargedUnitQuantity>0000001</ChargedUnitQuantity><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>2036980.00</IncentiveAmount><NetAmount>788190.00</NetAmount></ChargeInformation>
</Charge>
<Charge><ClassificationCode>ACC</ClassificationCode>
<ChargeInformation><DescriptionCode>DCS  </DescriptionCode><DescriptionOfCharges>Signature Required</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>65330.00</NetAmount></ChargeInformation>
<ChargeInformation><DescriptionCode>FIP  </DescriptionCode><DescriptionOfCharges>International Processing Fee</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>58750.00</NetAmount></ChargeInformation>
</Charge>
<Charge><ClassificationCode>FSC</ClassificationCode>
<ChargeInformation><DescriptionCode>FSC  </DescriptionCode><DescriptionOfCharges>Fuel Surcharge</DescriptionOfCharges><BasisValue>125.03</BasisValue><BasisCurrencyCode>VND</BasisCurrencyCode><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>983005.00</IncentiveAmount><NetAmount>434750.00</NetAmount></ChargeInformation>
</Charge>
<Charge><ClassificationCode>ACC</ClassificationCode>
<ChargeInformation><DescriptionCode>PFR  </DescriptionCode><DescriptionOfCharges>Surge Emergency Fee - Resi</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>17625.00</NetAmount></ChargeInformation>
<ChargeInformation><DescriptionCode>RES  </DescriptionCode><DescriptionOfCharges>Residential</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>95410.00</NetAmount></ChargeInformation>
<ChargeInformation><DescriptionCode>ZZZ  </DescriptionCode><DescriptionOfCharges>Phi la chua gap</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>1000.00</NetAmount></ChargeInformation>
</Charge>
<Charge><ClassificationCode>TAX</ClassificationCode>
<ChargeInformation><DescriptionCode>01   </DescriptionCode><DescriptionOfCharges>8.000 % Tax</DescriptionOfCharges><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>116560.00</NetAmount></ChargeInformation>
</Charge>
</ChargeDetails>
</Package>
<Package><TrackingNumber>1Z2050VDDG01187227</TrackingNumber><Zone>005</Zone><ContainerType>PKG</ContainerType>
<PackageWeight><ActualWeight><Weight>0.0</Weight><UnitOfMeasure>K</UnitOfMeasure></ActualWeight><BilledWeight><Weight>0.0</Weight><UnitOfMeasure>K</UnitOfMeasure></BilledWeight><BilledWeightType>09 </BilledWeightType></PackageWeight>
<ChargeDetails>
<Charge><ClassificationCode>INF</ClassificationCode>
<ChargeInformation><DescriptionCode>008  </DescriptionCode><DescriptionOfCharges>WW Expedited</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>0.00</NetAmount></ChargeInformation>
</Charge>
</ChargeDetails>
</Package>
<AddressDetails>
<SenderAddress><Addressee><Name>NGUOI GUI</Name></Addressee><Address><StreetAddress>1 DUONG A</StreetAddress><CityName>HA NOI</CityName><StateCode>HN</StateCode><PostalCode>100000</PostalCode><CountryorTerritoryCode>VN</CountryorTerritoryCode></Address></SenderAddress>
<ConsigneeAddress><Addressee><Name>NGUOI NHAN</Name></Addressee><Address><StreetAddress>2 MAIN ST</StreetAddress><CityName>MANHATTAN BEACH</CityName><StateCode>CA</StateCode><PostalCode>90266</PostalCode><CountryorTerritoryCode>US</CountryorTerritoryCode></Address></ConsigneeAddress>
</AddressDetails>
</Shipment>

<Shipment><TransactionDateCCYYMMDD>20260908</TransactionDateCCYYMMDD><LeadShipmentNumber>1Z2050VDDG27304524</LeadShipmentNumber>
<ShipmentReferences><Reference><Sequence>1</Sequence><ReferenceNumber>#MBLVD30078</ReferenceNumber></Reference></ShipmentReferences>
<Package><TrackingNumber>1Z2050VDDG27304524</TrackingNumber><ContainerType>PKG</ContainerType>
<PackageWeight><ActualWeight><Weight>2.0</Weight><UnitOfMeasure>K</UnitOfMeasure></ActualWeight><BilledWeight><Weight>2.5</Weight><UnitOfMeasure>K</UnitOfMeasure></BilledWeight></PackageWeight>
<ChargeDetails>
<Charge><ClassificationCode>FRT</ClassificationCode>
<ChargeInformation><DescriptionCode>008  </DescriptionCode><DescriptionOfCharges>Address Correction WW Expedited</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>289200.00</NetAmount></ChargeInformation>
<ChargeInformation><DescriptionCode>008  </DescriptionCode><DescriptionOfCharges>WW Expedited</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>2130745.00</IncentiveAmount><NetAmount>930600.00</NetAmount></ChargeInformation>
</Charge>
<Charge><ClassificationCode>ACC</ClassificationCode>
<ChargeInformation><DescriptionCode>F/D  </DescriptionCode><DescriptionOfCharges>D&amp;T Forwarding Surcharge</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>600425.00</NetAmount></ChargeInformation>
<ChargeInformation><DescriptionCode>ESD  </DescriptionCode><DescriptionOfCharges>Extended Area Surcharge-Destination</DescriptionOfCharges><TaxIndicator>1  </TaxIndicator><CurrencyCode>VND</CurrencyCode><IncentiveAmount>0.00</IncentiveAmount><NetAmount>646720.00</NetAmount></ChargeInformation>
</Charge>
</ChargeDetails>
</Package>
<AddressDetails>
<ConsigneeAddress><Addressee><Name>NGUOI NHAN 2</Name></Addressee><Address><StreetAddress>3 QUEEN ST</StreetAddress><CityName>SYDNEY</CityName><StateCode>NSW</StateCode><PostalCode>2000</PostalCode><CountryorTerritoryCode>AU</CountryorTerritoryCode></Address></ConsigneeAddress>
</AddressDetails>
</Shipment>
</TransactionDetails>
</Invoice>
</InvoiceDetails>
</UPS_EBR_BILL>`;

const tim = (t: string) => parseUpsInvoiceXml(XML)!.rows.find((r) => r.awb === t)!;

describe('thungChoKhoanUps — khoản phí UPS rơi vào cột nào', () => {
  it('phân theo ClassificationCode trước', () => {
    expect(thungChoKhoanUps({ lop: 'TAX', ma: '01', ten: '8.000 % Tax' })).toBe('vat');
    expect(thungChoKhoanUps({ lop: 'FSC', ma: 'FSC', ten: 'Fuel Surcharge' })).toBe('fuel');
    expect(thungChoKhoanUps({ lop: 'FRT', ma: '008', ten: 'WW Expedited' })).toBe('base');
    expect(thungChoKhoanUps({ lop: 'INF', ma: '008', ten: 'WW Expedited' })).toBe('bo');
  });
  it('ACC phân theo mã của UPS', () => {
    expect(thungChoKhoanUps({ lop: 'ACC', ma: 'FIP', ten: 'International Processing Fee' })).toBe('internationalProcessing');
    expect(thungChoKhoanUps({ lop: 'ACC', ma: 'DCS', ten: 'Signature Required' })).toBe('signature');
    expect(thungChoKhoanUps({ lop: 'ACC', ma: 'RES', ten: 'Residential' })).toBe('residential');
    expect(thungChoKhoanUps({ lop: 'ACC', ma: 'PFR', ten: 'Surge Emergency Fee - Resi' })).toBe('demand');
    expect(thungChoKhoanUps({ lop: 'ACC', ma: 'PFC', ten: 'Surge Emergency Fee - Com' })).toBe('demand');
    expect(thungChoKhoanUps({ lop: 'ACC', ma: 'ESD', ten: 'Extended Area Surcharge-Destination' })).toBe('remote');
    /* PHÍ DỊCH VỤ khi UPS ứng và làm thủ tục thuế, KHÔNG phải chính khoản thuế: hoá đơn ghi
     * TaxIndicator=1 (có VAT 8%) — đúng phép thử `classifyFboCharge` dùng cho FedEx. Để ở
     * `duty` thì nó chảy vào actual_duty_vnd của đơn ship hộ, tức thu lại của brand như thuế
     * ứng hộ, và `consolidateFboShipping` bỏ cả dòng khỏi đối soát cước. */
    expect(thungChoKhoanUps({ lop: 'ACC', ma: 'F/D', ten: 'D&T Forwarding Surcharge' })).toBe('importHandling');
  });
  it('mã ACC chưa biết → Khác, không im lặng nhét vào cột có nghĩa', () => {
    expect(thungChoKhoanUps({ lop: 'ACC', ma: 'ZZZ', ten: 'Phi la' })).toBe('other');
  });
  it('phí sửa địa chỉ nằm dưới class CƯỚC — mô tả thắng', () => {
    expect(thungChoKhoanUps({ lop: 'FRT', ma: '008', ten: 'Address Correction WW Expedited' })).toBe('addressCorrection');
  });
});

describe('parseUpsInvoiceXml — đầu hoá đơn', () => {
  it('đọc số hoá đơn (có khoảng trắng đuôi), ngày, tiền, chênh thuế', () => {
    const p = parseUpsInvoiceXml(XML)!;
    expect(p.billNumber).toBe('100000813108');
    expect(p.issueDate).toBe('2026-10-06');
    expect(p.dueDate).toBe('2026-11-05');
    expect(p.currency).toBe('VND');
    expect(p.amount).toBe(3_321_900);
    expect(p.taxVariance).toBe(7_746);
  });
  it('kỳ = ngày đi hàng SỚM NHẤT → MUỘN NHẤT (không phải ngày hoá đơn)', () => {
    const p = parseUpsInvoiceXml(XML)!;
    expect(p.periodStart).toBe('2026-09-03');
    expect(p.periodEnd).toBe('2026-09-08');
  });
  it('không phải file UPS → null', () => {
    expect(parseUpsInvoiceXml('<Invoice><ID>HANR1</ID></Invoice>')).toBeNull();
    expect(parseUpsInvoiceXml('')).toBeNull();
    expect(laHoaDonUpsXml(XML)).toBe(true);
  });
});

describe('parseUpsInvoiceXml — gộp theo VẬN ĐƠN', () => {
  it('mỗi vận đơn một dòng, dù xuất hiện ở nhiều nhóm TransactionDetails', () => {
    const p = parseUpsInvoiceXml(XML)!;
    expect(p.rows.map((r) => r.awb).sort()).toEqual(['1Z2050VDDG01187227', '1Z2050VDDG27304524']);
    expect(p.soKhoan).toBe(15); // 2 ở lượt điều chỉnh + 9 (gồm 1 dòng INF bị bỏ) + 4
  });
  it('dòng điều chỉnh gộp vào chính vận đơn đó', () => {
    const r = tim('1Z2050VDDG27304524');
    // cước: 140.060 (điều chỉnh, không chiết khấu) + 930.600 + 2.130.745 niêm yết
    expect(r.base).toBe(140_060 + 930_600 + 2_130_745);
    expect(r.discount).toBe(-2_130_745);
    expect(r.vat).toBe(11_045);
    expect(r.addressCorrection).toBe(289_200);
    expect(r.importHandling).toBe(600_425);
    expect(r.duty).toBe(0);
    expect(r.remote).toBe(646_720);
  });
  it('cân lấy MAX qua các kiện, KHÔNG cộng (kiện INF 0đ và lượt điều chỉnh)', () => {
    expect(tim('1Z2050VDDG01187227').weightKg).toBe(1.5);
    expect(tim('1Z2050VDDG27304524').weightKg).toBe(3); // 3.0 ở lượt điều chỉnh > 2.5
  });
  it('ngày đi lấy ngày SỚM NHẤT; địa chỉ điền bù từ lượt sau', () => {
    const r = tim('1Z2050VDDG27304524');
    expect(r.shipDate).toBe('2026-09-08');
    expect(r.recipientCountry).toBe('AU');
    expect(r.recipientCity).toBe('SYDNEY');
  });
  it('tên dịch vụ lấy từ dòng cước thật, không lấy "…Adjustment"', () => {
    expect(tim('1Z2050VDDG27304524').service).toBe('WW Expedited');
    expect(tim('1Z2050VDDG01187227').service).toBe('WW Expedited');
  });
});

describe('parseUpsInvoiceXml — ghép vào cột', () => {
  it('base là cước NIÊM YẾT, discount là số ÂM (quy ước FedEx)', () => {
    const r = tim('1Z2050VDDG01187227');
    expect(r.base).toBe(788_190 + 2_036_980);
    expect(r.discount).toBe(-2_036_980);
    expect(r.base + r.discount).toBe(788_190); // thực trả
  });
  it('fuel là số THỰC TRẢ của dòng FSC', () => {
    expect(tim('1Z2050VDDG01187227').fuel).toBe(434_750);
  });
  it('phí xử lý quốc tế vào CỘT RIÊNG, không trộn vào Khác', () => {
    const r = tim('1Z2050VDDG01187227');
    expect(r.internationalProcessing).toBe(58_750);
    expect(r.other).toBe(1_000); // chỉ còn mã ZZZ lạ
  });
  it('phụ phí còn lại vào đúng cột', () => {
    const r = tim('1Z2050VDDG01187227');
    expect(r.signature).toBe(65_330);
    expect(r.residential).toBe(95_410);
    expect(r.demand).toBe(17_625);
    expect(r.vat).toBe(116_560);
  });
  it('dòng INF 0đ bị bỏ — không đẻ thêm cột và không đụng tổng', () => {
    const r = tim('1Z2050VDDG01187227');
    expect(r.total).toBe(788_190 + 65_330 + 58_750 + 434_750 + 17_625 + 95_410 + 1_000 + 116_560);
  });
  it('mã phí lạ được NÊU RA, không nằm im trong cột Khác', () => {
    expect(parseUpsInvoiceXml(XML)!.maLa).toEqual(['ACC/ZZZ']);
  });
  it('Σ mọi cột = Σ tổng dòng — không rơi và không đếm hai lần khoản nào', () => {
    const p = parseUpsInvoiceXml(XML)!;
    const cot = ['base', 'discount', 'fuel', 'demand', 'remote', 'signature', 'residential',
      'addressCorrection', 'importHandling', 'duty', 'additionalHandling',
      'internationalProcessing', 'vat', 'other'] as const;
    const sumCot = p.rows.reduce((s, r) => s + cot.reduce((a, k) => a + r[k], 0), 0);
    expect(sumCot).toBe(p.rows.reduce((s, r) => s + r.total, 0));
  });
});
