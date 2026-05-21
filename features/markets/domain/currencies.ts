export interface CurrencySettingsInput {
  baseCurrency: string;
  localCurrencies: boolean;
}

export function buildCurrencySettingsInput(
  primary: string,
  alternatives: string[],
): CurrencySettingsInput {
  return {
    baseCurrency: primary,
    localCurrencies: alternatives.length > 0,
  };
}

export const CURRENCY_SETTINGS_UPDATE_MUTATION = `
  mutation MarketCurrencySettingsUpdate($marketId: ID!, $input: MarketCurrencySettingsUpdateInput!) {
    marketCurrencySettingsUpdate(marketId: $marketId, input: $input) {
      market { id }
      userErrors { field message }
    }
  }
`;
