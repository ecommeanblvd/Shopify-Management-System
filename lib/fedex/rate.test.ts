import { describe, expect, it } from 'vitest';
import { buildRateRequest, parseRateReply, categorizeSurcharges } from './rate';

describe('categorizeSurcharges', () => {
  it('gom đúng: ANCILLARY_FEE→countryFixed (import handling), SIGNATURE→signature', () => {
    const c = categorizeSurcharges([
      { type: 'FUEL', amount: 100 },
      { type: 'RESIDENTIAL_DELIVERY', amount: 84_400 },
      { type: 'ANCILLARY_FEE', amount: 68_300 }, // US Inbound Processing Fee = phí cố định nước
      { type: 'SIGNATURE_OPTION', amount: 92_700 }, // ký nhận thật
      { type: 'DELIVERY_AREA_SURCHARGE', amount: 50_000 },
      { type: 'PEAK_SURCHARGE', amount: 30_000 },
      { type: 'SOMETHING_ELSE', amount: 9 },
    ]);
    expect(c).toEqual({ fuel: 100, residential: 84_400, signature: 92_700, countryFixed: 68_300, remote: 50_000, demand: 30_000, other: 9 });
  });
  it('cộng dồn cùng thùng (vd 2 dòng remote)', () => {
    const c = categorizeSurcharges([
      { type: 'OUT_OF_DELIVERY_AREA', amount: 10 },
      { type: 'EXTENDED_DELIVERY_AREA', amount: 5 },
    ]);
    expect(c.remote).toBe(15);
  });
});

describe('parseRateReply — named components', () => {
  it('bóc fuel%, VAT, discount, billing weight, zone, components', () => {
    const reply = {
      output: { rateReplyDetails: [{
        serviceType: 'FEDEX_INTERNATIONAL_PRIORITY',
        ratedShipmentDetails: [{
          rateType: 'ACCOUNT', currency: 'VND', totalNetCharge: 1_807_458,
          shipmentRateDetail: {
            totalSurcharges: 635_404, rateZone: '5', fuelSurchargePercent: 42.5,
            totalBillingWeight: { units: 'KG', value: 2 },
            totalFreightDiscount: 2_404_032,
            surCharges: [
              { type: 'FUEL', amount: 482_704 },
              { type: 'RESIDENTIAL_DELIVERY', amount: 84_400 },
              { type: 'ANCILLARY_FEE', amount: 68_300 }, // → countryFixed
            ],
            taxes: [{ type: 'VAT', description: 'Vietnam value-added', amount: 133_886 }],
          },
        }],
      }] },
    };
    const [q] = parseRateReply(reply);
    expect(q.fuelPercent).toBe(42.5);
    expect(q.vat).toBe(133_886);
    expect(q.discount).toBe(2_404_032);
    expect(q.billingWeightKg).toBe(2);
    expect(q.rateZone).toBe('5');
    expect(q.components.fuel).toBe(482_704);
    expect(q.components.residential).toBe(84_400);
    expect(q.components.countryFixed).toBe(68_300); // ANCILLARY_FEE = phí cố định nước, KHÔNG phải ký nhận
    expect(q.components.signature).toBe(0);
  });
});

interface RateBody {
  accountNumber: { value: string };
  requestedShipment: {
    shipper: { address: { countryCode: string } };
    recipient: { address: { countryCode: string; residential: boolean } };
    rateRequestType: string[];
    requestedPackageLineItems: Array<{
      weight: { units: string; value: number };
      dimensions?: { length: number; width: number; height: number; units: string };
      packageSpecialServices?: { specialServiceTypes: string[]; signatureOptionType: string };
    }>;
    customsClearanceDetail?: {
      commodities: Array<{ countryOfManufacture: string; customsValue: { amount: number; currency: string } }>;
    };
  };
}
const asBody = (v: Record<string, unknown>): RateBody => v as unknown as RateBody;

describe('buildRateRequest', () => {
  it('gắn account + origin/dest + cân, mặc định không residential', () => {
    const body = asBody(buildRateRequest(
      { shipperCountryCode: 'VN', recipientCountryCode: 'HK', weightKg: 1.5 },
      '802093821',
    ));
    expect(body.accountNumber).toEqual({ value: '802093821' });
    expect(body.requestedShipment.shipper.address.countryCode).toBe('VN');
    expect(body.requestedShipment.recipient.address.countryCode).toBe('HK');
    expect(body.requestedShipment.recipient.address.residential).toBe(false);
    expect(body.requestedShipment.requestedPackageLineItems[0].weight).toEqual({ units: 'KG', value: 1.5 });
    expect(body.requestedShipment.rateRequestType).toEqual(['ACCOUNT', 'LIST']);
  });

  it('thêm dimensions khi có dims', () => {
    const body = asBody(buildRateRequest(
      { shipperCountryCode: 'VN', recipientCountryCode: 'AU', weightKg: 2, dimsCm: { length: 30, width: 20, height: 10 } },
      'A',
    ));
    expect(body.requestedShipment.requestedPackageLineItems[0].dimensions).toEqual({
      length: 30, width: 20, height: 10, units: 'CM',
    });
  });

  it('thêm customsClearanceDetail cho hàng quốc tế (VN→HK)', () => {
    const body = asBody(buildRateRequest({ shipperCountryCode: 'VN', recipientCountryCode: 'HK', weightKg: 1.5 }, 'A'));
    const ccd = body.requestedShipment.customsClearanceDetail;
    expect(ccd).toBeDefined();
    expect(ccd!.commodities[0].countryOfManufacture).toBe('VN');
    expect(ccd!.commodities[0].customsValue).toEqual({ amount: 100, currency: 'USD' });
  });

  it('KHÔNG thêm customs cho hàng nội địa (VN→VN)', () => {
    const body = asBody(buildRateRequest({ shipperCountryCode: 'VN', recipientCountryCode: 'VN', weightKg: 1 }, 'A'));
    expect(body.requestedShipment.customsClearanceDetail).toBeUndefined();
  });

  it('signatureOptIn=true → packageSpecialServices SIGNATURE_OPTION/DIRECT', () => {
    const body = asBody(buildRateRequest({ shipperCountryCode: 'VN', recipientCountryCode: 'US', weightKg: 2, signatureOptIn: true }, 'A'));
    expect(body.requestedShipment.requestedPackageLineItems[0].packageSpecialServices).toEqual({
      specialServiceTypes: ['SIGNATURE_OPTION'], signatureOptionType: 'DIRECT',
    });
  });

  it('không signatureOptIn → KHÔNG có packageSpecialServices', () => {
    const body = asBody(buildRateRequest({ shipperCountryCode: 'VN', recipientCountryCode: 'US', weightKg: 2 }, 'A'));
    expect(body.requestedShipment.requestedPackageLineItems[0].packageSpecialServices).toBeUndefined();
  });

  it('truyền residential=true khi chỉ định', () => {
    const body = asBody(buildRateRequest(
      { shipperCountryCode: 'VN', recipientCountryCode: 'PH', weightKg: 1, recipientResidential: true },
      'A',
    ));
    expect(body.requestedShipment.recipient.address.residential).toBe(true);
  });
});

describe('parseRateReply', () => {
  it('bóc service, total, base, và từng phụ phí', () => {
    const reply = {
      output: {
        rateReplyDetails: [
          {
            serviceType: 'INTERNATIONAL_PRIORITY',
            serviceName: 'FedEx International Priority',
            commit: { transitDays: { description: '2 business days' } },
            ratedShipmentDetails: [
              {
                rateType: 'ACCOUNT',
                currency: 'VND',
                totalNetCharge: 681584,
                shipmentRateDetail: {
                  totalBaseCharge: 600000,
                  totalSurcharges: 81584,
                  surCharges: [
                    { type: 'FUEL', description: 'Fuel Surcharge', amount: 60000 },
                    { type: 'PEAK', description: 'Demand Surcharge', amount: 21584 },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    const quotes = parseRateReply(reply);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].serviceType).toBe('INTERNATIONAL_PRIORITY');
    expect(quotes[0].rateType).toBe('ACCOUNT');
    expect(quotes[0].totalNetCharge).toBe(681584);
    expect(quotes[0].baseCharge).toBe(600000);
    expect(quotes[0].surcharges).toEqual([
      { type: 'FUEL', description: 'Fuel Surcharge', amount: 60000 },
      { type: 'PEAK', description: 'Demand Surcharge', amount: 21584 },
    ]);
    expect(quotes[0].transitDays).toBe('2 business days');
  });

  it('trả mảng rỗng khi shape thiếu', () => {
    expect(parseRateReply({})).toEqual([]);
    expect(parseRateReply(null)).toEqual([]);
    expect(parseRateReply({ output: {} })).toEqual([]);
  });
});
