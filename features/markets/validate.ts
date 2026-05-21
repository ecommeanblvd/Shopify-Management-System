import type { Market, MarketStoreOverride } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const ISO2 = /^[A-Z]{2}$/;

export function validateTemplate(markets: Market[]): void {
  const handles = new Set<string>();
  const countryOwner = new Map<string, string>();
  let internationalCount = 0;

  for (const m of markets) {
    if (handles.has(m.handle)) {
      throw new ValidationError(`Duplicate handle: ${m.handle}`);
    }
    handles.add(m.handle);

    if (m.type === 'international') {
      internationalCount++;
      if (m.countries.length > 0) {
        throw new ValidationError(
          `International market '${m.handle}' must have empty countries`,
        );
      }
    } else {
      if (m.countries.length === 0) {
        throw new ValidationError(
          `Regional market '${m.handle}' must have at least one country`,
        );
      }
      for (const c of m.countries) {
        if (!ISO2.test(c)) {
          throw new ValidationError(`Invalid country code '${c}' in market '${m.handle}'`);
        }
        const owner = countryOwner.get(c);
        if (owner) {
          throw new ValidationError(
            `Country ${c} assigned to both '${owner}' and '${m.handle}'`,
          );
        }
        countryOwner.set(c, m.handle);
      }
    }
  }

  if (internationalCount !== 1) {
    throw new ValidationError(
      `Template must contain exactly one international market (found ${internationalCount})`,
    );
  }
}

export function validateOverride(market: Market, override: MarketStoreOverride): void {
  if (override.priceAdjustment) {
    const v = override.priceAdjustment.value;
    if (v < -50 || v > 200) {
      throw new ValidationError(
        `Price adjustment ${v}% must be between -50 and 200`,
      );
    }
  }

  if (override.shipping) {
    const allowedCurrencies = new Set([
      market.primaryCurrency,
      ...market.alternativeCurrencies,
    ]);
    const marketCountries = new Set(market.countries);
    const isInternational = market.type === 'international';

    for (const [zoneName, zone] of Object.entries(override.shipping.zones)) {
      for (const c of zone.countries) {
        if (!isInternational && !marketCountries.has(c)) {
          throw new ValidationError(
            `Zone '${zoneName}': country ${c} is not in market ${market.handle} countries`,
          );
        }
      }
      for (const [rateName, rate] of Object.entries(zone.rates)) {
        if (!allowedCurrencies.has(rate.currency)) {
          throw new ValidationError(
            `Zone '${zoneName}' rate '${rateName}': currency ${rate.currency} is not in market ${market.handle} currencies`,
          );
        }
      }
    }
  }
}
