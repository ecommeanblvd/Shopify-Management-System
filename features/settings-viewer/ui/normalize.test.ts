import { describe, it, expect } from 'vitest';
import { normalizeShipping, formatMoney, rateTypeLabel, isShippingError } from './normalize';

describe('normalizeShipping', () => {
  it('flattens profiles → zones → countries → rates and counts totals', () => {
    const raw = {
      deliveryProfiles: {
        edges: [
          {
            node: {
              name: 'General profile',
              profileLocationGroups: [
                {
                  locationGroupZones: {
                    edges: [
                      {
                        node: {
                          zone: {
                            name: 'Asia',
                            countries: [
                              { code: { countryCode: 'VN', restOfWorld: false } },
                              { code: { countryCode: 'TH', restOfWorld: false } },
                            ],
                          },
                          methodDefinitions: {
                            edges: [
                              {
                                node: {
                                  name: 'Standard',
                                  rateProvider: {
                                    __typename: 'DeliveryRateDefinition',
                                    price: { amount: '12.50', currencyCode: 'USD' },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      },
                      {
                        node: {
                          zone: {
                            name: 'Rest of the World',
                            countries: [{ code: { countryCode: null, restOfWorld: true } }],
                          },
                          methodDefinitions: { edges: [] },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    };

    const out = normalizeShipping(raw);
    expect(out.totals).toEqual({ profiles: 1, zones: 2, rates: 1, countries: 2 });
    expect(out.profiles[0].name).toBe('General profile');
    expect(out.profiles[0].zones[0]).toMatchObject({
      name: 'Asia',
      countries: ['VN', 'TH'],
      restOfWorld: false,
    });
    expect(out.profiles[0].zones[0].rates[0]).toMatchObject({
      name: 'Standard',
      type: 'flat',
      price: { amount: 12.5, currency: 'USD' },
    });
    expect(out.profiles[0].zones[1].restOfWorld).toBe(true);
  });

  it('returns empty totals for empty input', () => {
    const out = normalizeShipping({});
    expect(out.totals).toEqual({ profiles: 0, zones: 0, rates: 0, countries: 0 });
    expect(out.profiles).toEqual([]);
  });

  it('handles missing price gracefully', () => {
    const raw = {
      deliveryProfiles: {
        edges: [{ node: {
          name: 'p', profileLocationGroups: [{ locationGroupZones: { edges: [{ node: {
            zone: { name: 'z', countries: [] },
            methodDefinitions: { edges: [{ node: { name: 'Carrier-calc', rateProvider: { __typename: 'DeliveryCarrierService' } } }] },
          } }] } }],
        } }],
      },
    };
    const out = normalizeShipping(raw);
    expect(out.profiles[0].zones[0].rates[0]).toMatchObject({
      name: 'Carrier-calc',
      type: 'carrier',
      price: null,
    });
  });
});

describe('formatMoney', () => {
  it('formats USD', () => {
    expect(formatMoney(12.5, 'USD')).toMatch(/\$12\.50|US\$12\.50|12\.50\s?US?\$?/);
  });
  it('falls back when currency is unknown', () => {
    const out = formatMoney(10, 'XYZ');
    expect(out).toContain('10');
    expect(out).toContain('XYZ');
  });
});

describe('rateTypeLabel', () => {
  it('maps each type', () => {
    expect(rateTypeLabel('flat')).toBe('Flat rate');
    expect(rateTypeLabel('carrier')).toBe('Carrier');
    expect(rateTypeLabel('participant')).toBe('App provider');
    expect(rateTypeLabel('other')).toBe('Other');
  });
});

describe('isShippingError', () => {
  it('detects error envelope', () => {
    expect(isShippingError({ error: 'fail' })).toBe(true);
    expect(isShippingError({ error: 'fail', detail: 'because' })).toBe(true);
    expect(isShippingError({ deliveryProfiles: {} })).toBe(false);
    expect(isShippingError(null)).toBe(false);
  });
});
