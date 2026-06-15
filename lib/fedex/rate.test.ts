import { describe, expect, it } from 'vitest';
import { buildRateRequest, parseRateReply } from './rate';

interface RateBody {
  accountNumber: { value: string };
  requestedShipment: {
    shipper: { address: { countryCode: string } };
    recipient: { address: { countryCode: string; residential: boolean } };
    rateRequestType: string[];
    requestedPackageLineItems: Array<{
      weight: { units: string; value: number };
      dimensions?: { length: number; width: number; height: number; units: string };
    }>;
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
